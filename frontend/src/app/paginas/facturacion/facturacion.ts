import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { FacturacionApi, mensajeDeError } from '../../core/api/api';
import type {
  ConfigFiscal,
  EmisorProfesional,
  Factura,
  ModoArca,
  PendienteFactura,
} from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { tieneModulo } from '../../core/auth/modulos';
import { nombreMes, plata, sumarMes } from '../../core/cobros';
import { enlaceWhatsApp } from '../../core/contacto';
import { ahoraEn } from '../../core/fechas';

type Pestana = 'pendientes' | 'emitidas' | 'datos';

const NOMBRE_MODO: Record<ModoArca, string> = {
  simulado: 'Simulado (sin conexión con ARCA)',
  homologacion: 'Homologación (pruebas de ARCA)',
  produccion: 'Producción',
};

/**
 * Facturación electrónica C con ARCA (portado de facturacion.php): por mes, una
 * factura por paciente particular con las sesiones cobradas; las emitidas, con
 * su PDF y para mandar por WhatsApp; y los datos fiscales y el certificado.
 *
 * Emisor: el centro, o cada profesional con su CUIT si el centro lo eligió. En ese
 * caso admin y recepción eligen el profesional, y el profesional ve lo suyo.
 */
@Component({
  selector: 'app-facturacion',
  imports: [FormsModule, RouterLink],
  templateUrl: './facturacion.html',
  styles: `
    .cabecera,
    .fila {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .periodo {
      display: flex;
      align-items: center;
      gap: 0.375rem;
    }
    .mes {
      min-width: 9.5rem;
      text-align: center;
      font-weight: 600;
    }
    .num {
      text-align: right !important;
      white-space: nowrap;
    }
    .grilla {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      align-items: end;
      gap: 0.75rem;
    }
    .seccion {
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
    }
    .pasos {
      margin: 0;
      padding-left: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    textarea {
      width: 100%;
      min-height: 7rem;
      font-family: var(--oc-fuente-mono);
      font-size: 0.75rem;
    }
    .nota {
      font-size: 0.75rem;
    }
    .emisor {
      max-width: 28rem;
    }
    .acciones-fila {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      justify-content: flex-end;
    }
  `,
})
export class Facturacion {
  private readonly api = inject(FacturacionApi);
  private readonly auth = inject(AuthService);
  private readonly hoy = computed(() => ahoraEn(this.auth.sesion()?.centro?.zonaHoraria).fecha);

  protected readonly esAdmin = computed(() => this.auth.sesion()?.rol === 'admin');
  protected readonly esProfesional = computed(() => this.auth.sesion()?.rol === 'profesional');
  /** Admin o el propio profesional cambian datos fiscales; recepción solo los ve. */
  protected readonly editaDatos = computed(() => this.esAdmin() || this.esProfesional());
  /** Datos del centro (admin y recepción): dicen si factura cada profesional. */
  protected readonly centro = signal<ConfigFiscal | null>(null);
  protected readonly emisores = signal<EmisorProfesional[]>([]);
  /** Profesional elegido como emisor (admin y recepción, si factura cada uno). */
  protected readonly emisorId = signal<string | null>(null);
  /** El profesional entró pero en el centro factura el centro. */
  protected readonly sinAcceso = signal(false);
  /** El plan permite que cada profesional facture con su CUIT. */
  protected readonly porProfesional = computed(() =>
    tieneModulo(this.auth.sesion(), 'arca_por_profesional'),
  );
  protected readonly cadaProfesional = computed(
    () => (this.centro() ?? this.config())?.facturaCadaProfesional ?? false,
  );
  /** Por defecto, el mes anterior (se factura cuando terminó). */
  protected readonly mes = signal(sumarMes(this.hoy().slice(0, 7), -1));
  protected readonly pestana = signal<Pestana>('pendientes');
  protected readonly config = signal<ConfigFiscal | null>(null);
  protected readonly pendientes = signal<PendienteFactura[]>([]);
  protected readonly facturas = signal<Factura[]>([]);
  protected readonly elegidos = signal<Set<string>>(new Set());
  protected readonly ocupado = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly mensaje = signal<string | null>(null);
  protected readonly csr = signal<string | null>(null);
  protected datos: Partial<ConfigFiscal> = {};
  protected certificado = '';

  protected readonly plata = plata;
  protected readonly nombreModo = NOMBRE_MODO;
  protected readonly modos = Object.keys(NOMBRE_MODO) as ModoArca[];
  protected readonly titulo = computed(() => nombreMes(this.mes()));
  protected readonly paraFacturar = computed(() => this.pendientes().filter((p) => p.sesiones > 0));
  protected readonly conAvisos = computed(() => this.pendientes().filter((p) => p.impagas > 0));
  protected readonly totalElegido = computed(() =>
    this.paraFacturar()
      .filter((p) => this.elegidos().has(p.paciente.id))
      .reduce((a, p) => a + p.total, 0),
  );
  protected readonly emitidas = computed(() =>
    this.facturas().filter((f) => f.estado === 'emitida'),
  );
  protected readonly rechazadas = computed(() =>
    this.facturas().filter((f) => f.estado === 'rechazada'),
  );
  protected readonly enviadas = computed(() => this.emitidas().filter((f) => f.enviada).length);
  protected readonly dmy = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—');
  protected readonly nro = (f: Factura) =>
    `${String(f.ptoVta).padStart(5, '0')}-${String(f.numero ?? 0).padStart(8, '0')}`;

  constructor() {
    effect(() => {
      const mes = this.mes();
      untracked(() => void this.cargar(mes));
    });
    void this.cargarConfig().then(() => this.cargar(this.mes()));
  }

  /** profesionalId para la API: el emisor elegido por admin o recepción. */
  private prof(): string | undefined {
    return this.cadaProfesional() && !this.esProfesional()
      ? (this.emisorId() ?? undefined)
      : undefined;
  }

  protected async elegirEmisor(id: string): Promise<void> {
    this.emisorId.set(id || null);
    this.csr.set(null);
    await this.cargarConfig();
    await this.cargar(this.mes());
  }

  /** Admin: el centro factura todo, o cada profesional con su CUIT. */
  protected alternarCadaProfesional(valor: boolean) {
    const texto = valor
      ? 'Cada profesional va a facturar sus sesiones particulares con su propio CUIT y certificado. ¿Seguir?'
      : 'El centro va a facturar todas las sesiones con sus datos fiscales. ¿Seguir?';
    if (!confirm(texto)) {
      this.centro.update((c) => (c ? { ...c } : c));
      return;
    }
    return this.hacer(async () => {
      this.centro.set(await this.api.guardarConfig({ facturaCadaProfesional: valor }));
      this.emisorId.set(null);
      await this.cargarConfig();
      this.mensaje.set(valor ? 'Ahora factura cada profesional.' : 'Ahora factura el centro.');
    });
  }

  protected moverMes(n: number): void {
    this.mes.update((m) => sumarMes(m, n));
  }

  protected alternar(id: string): void {
    this.elegidos.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected async emitir(): Promise<void> {
    const ids = [...this.elegidos()];
    if (!ids.length) return;
    const modo = this.config()?.modo;
    if (
      !confirm(
        `¿Emitir ${ids.length} ${ids.length === 1 ? 'factura' : 'facturas'} por ${plata(this.totalElegido())}?` +
          (modo === 'produccion' ? ' Se emiten en ARCA con validez fiscal.' : ''),
      )
    )
      return;
    await this.hacer(async () => {
      const r = await this.api.emitir(this.mes(), ids, this.prof());
      const errores = r.resultados.filter((x) => !x.ok);
      this.mensaje.set(
        r.emitidas === 1 ? 'Se emitió 1 factura.' : `Se emitieron ${r.emitidas} facturas.`,
      );
      if (errores.length) {
        const nombre = (id: string) => {
          const p = this.pendientes().find((x) => x.paciente.id === id)?.paciente;
          return p ? `${p.nombre} ${p.apellido}` : id;
        };
        this.error.set(
          'No se pudieron emitir: ' +
            errores.map((e) => `${nombre(e.pacienteId)}: ${e.error}`).join(' · '),
        );
      }
      this.pestana.set('emitidas');
    });
  }

  protected async verPdf(f: Factura): Promise<void> {
    try {
      const blob = await this.api.pdf(f.id);
      window.open(URL.createObjectURL(blob), '_blank');
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo abrir el PDF.'));
    }
  }

  /** Comparte el PDF (celular) o lo descarga; después se puede marcar como enviada. */
  protected async compartir(f: Factura): Promise<void> {
    try {
      const blob = await this.api.pdf(f.id);
      const archivo = new File([blob], `factura-${this.nro(f)}.pdf`, { type: 'application/pdf' });
      const texto = `Hola ${f.paciente.nombre}, te envío la factura de las sesiones de ${this.titulo()}. ¡Gracias!`;
      if (navigator.canShare?.({ files: [archivo] })) {
        await navigator.share({ files: [archivo], text: texto });
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = archivo.name;
        a.click();
        const wa = enlaceWhatsApp(f.paciente.telefono);
        if (wa) window.open(`${wa}?text=${encodeURIComponent(texto)}`, '_blank');
      }
      if (!f.enviada) await this.alternarEnviada(f);
    } catch (e) {
      if ((e as Error).name !== 'AbortError')
        this.error.set(mensajeDeError(e, 'No se pudo compartir.'));
    }
  }

  protected alternarEnviada(f: Factura) {
    return this.hacer(() => this.api.marcarEnviada(f.id, !f.enviada));
  }

  // ───────── Datos fiscales ─────────

  protected guardarDatos() {
    return this.hacer(async () => {
      this.config.set(
        await this.api.guardarConfig(
          {
            cuit: this.datos.cuit || null,
            razonSocial: this.datos.razonSocial || null,
            domicilio: this.datos.domicilio || null,
            inicioActividades: this.datos.inicioActividades || null,
            ptoVta: Number(this.datos.ptoVta),
            modo: this.datos.modo,
            textoItem: this.datos.textoItem,
          },
          this.prof(),
        ),
      );
      if (this.cadaProfesional() && !this.esProfesional())
        this.emisores.set(await this.api.emisores());
      this.mensaje.set('Datos fiscales guardados.');
    });
  }

  protected pedirCertificado() {
    const c = this.config();
    if (
      c?.tieneCertificado &&
      !confirm(
        'Ya hay un certificado cargado. Un pedido nuevo genera otra clave y deja sin efecto el actual. ¿Seguir?',
      )
    )
      return;
    return this.hacer(async () => {
      const r = await this.api.pedirCertificado(this.prof());
      this.csr.set(r.csr);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([r.csr], { type: 'application/pkcs10' }));
      a.download = 'pedido-arca.csr';
      a.click();
      await this.cargarConfig();
    });
  }

  protected async leerArchivo(ev: Event): Promise<void> {
    const archivo = (ev.target as HTMLInputElement).files?.[0];
    if (archivo) this.certificado = await archivo.text();
  }

  protected guardarCertificado() {
    return this.hacer(async () => {
      this.config.set(await this.api.guardarCertificado(this.certificado, this.prof()));
      this.certificado = '';
      this.mensaje.set('Certificado guardado.');
    });
  }

  protected probar() {
    return this.hacer(async () => this.mensaje.set((await this.api.probar(this.prof())).mensaje));
  }

  // ───────── Internos ─────────

  private async hacer(op: () => Promise<unknown>): Promise<void> {
    this.ocupado.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      await op();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.ocupado.set(false);
      await this.cargar(this.mes());
    }
  }

  private async cargarConfig(): Promise<void> {
    try {
      if (this.esProfesional()) {
        // Sus propios datos; si factura el centro, la API responde 403.
        const c = await this.api.config();
        this.config.set(c);
        this.datos = { ...c };
        return;
      }
      const centro = await this.api.config();
      this.centro.set(centro);
      if (!centro.facturaCadaProfesional) {
        this.emisores.set([]);
        this.config.set(centro);
        this.datos = { ...centro };
        return;
      }
      const emisores = await this.api.emisores();
      this.emisores.set(emisores);
      if (!emisores.some((e) => e.profesional.id === this.emisorId()))
        this.emisorId.set(emisores[0]?.profesional.id ?? null);
      const id = this.emisorId();
      const c = id ? await this.api.config(id) : null;
      this.config.set(c);
      this.datos = c ? { ...c } : {};
    } catch (e) {
      if (this.esProfesional() && e instanceof HttpErrorResponse && e.status === 403) {
        this.sinAcceso.set(true);
        return;
      }
      this.error.set(mensajeDeError(e));
    }
  }

  private async cargar(mes: string): Promise<void> {
    // Todavía sin datos, o el centro factura y quien entra es un profesional.
    if (this.sinAcceso() || (!this.config() && !this.centro())) return;
    if (this.cadaProfesional() && !this.esProfesional() && !this.emisorId()) {
      this.pendientes.set([]);
      this.facturas.set([]);
      return;
    }
    try {
      const [pendientes, facturas] = await Promise.all([
        this.api.pendientes(mes, this.prof()),
        this.api.facturas(mes, this.prof()),
      ]);
      if (mes !== this.mes()) return;
      this.pendientes.set(pendientes);
      this.facturas.set(facturas);
      // Por defecto se eligen los que tienen DNI.
      this.elegidos.set(
        new Set(pendientes.filter((p) => p.sesiones && !p.sinDni).map((p) => p.paciente.id)),
      );
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo cargar la facturación del mes.'));
    }
  }
}

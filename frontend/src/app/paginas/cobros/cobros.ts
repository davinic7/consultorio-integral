import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CobrosApi, LiquidacionesApi, mensajeDeError } from '../../core/api/api';
import type {
  Conciliacion,
  LiquidacionProfesional,
  MedioPago,
  Prestacion,
  ResumenCobros,
} from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { tieneModulo } from '../../core/auth/modulos';
import { puede } from '../../core/auth/roles';
import {
  CLASE_COBRO,
  MEDIOS,
  NOMBRE_AVISO,
  NOMBRE_COBRO,
  NOMBRE_LIQUIDACION,
  NOMBRE_MEDIO,
  nombreMes,
  plata,
  sumarMes,
} from '../../core/cobros';
import { colorDisciplina, iniciales } from '../../core/disciplina';
import { ahoraEn } from '../../core/fechas';
import { DetalleCobro } from './detalle-cobro';

type Seccion = 'cobros' | 'liquidacion';
type Filtro = 'todos' | 'por_cobrar' | 'cobradas' | 'avisos';

/**
 * Cobros y liquidación (docs/diseno/referencia/Cobros.dc.html). Por mes:
 * indicadores, sesiones para cobrar con su estado, gráficos por medio y por día,
 * lo que no cierra (conciliación) y la liquidación de cada profesional.
 * Admin y recepción cobran; el admin liquida; el profesional ve lo suyo.
 */
@Component({
  selector: 'app-cobros',
  imports: [FormsModule, RouterLink, DetalleCobro],
  templateUrl: './cobros.html',
  styleUrl: './cobros.scss',
})
export class Cobros {
  private readonly api = inject(CobrosApi);
  private readonly liquidacionesApi = inject(LiquidacionesApi);
  private readonly auth = inject(AuthService);

  private readonly rol = computed(() => this.auth.sesion()?.rol);
  protected readonly gestiona = computed(() => puede(this.rol(), 'admin', 'recepcion'));
  protected readonly esAdmin = computed(() => this.rol() === 'admin');
  protected readonly esProfesional = computed(() => this.rol() === 'profesional');
  /** Recepción no ve liquidaciones; tampoco se ven si el plan no las incluye. */
  protected readonly veLiquidacion = computed(
    () =>
      puede(this.rol(), 'admin', 'profesional') &&
      tieneModulo(this.auth.sesion(), 'liquidacion'),
  );
  private readonly hoy = computed(() => ahoraEn(this.auth.sesion()?.centro?.zonaHoraria).fecha);

  protected readonly mes = signal(this.hoy().slice(0, 7));
  protected readonly seccion = signal<Seccion>('cobros');
  protected readonly filtro = signal<Filtro>('todos');
  protected readonly aviso = signal<string | null>(null);

  protected readonly prestaciones = signal<Prestacion[]>([]);
  protected readonly resumen = signal<ResumenCobros | null>(null);
  protected readonly conciliacion = signal<Conciliacion | null>(null);
  protected readonly liquidaciones = signal<LiquidacionProfesional[]>([]);
  protected readonly cargando = signal(true);
  protected readonly ocupado = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly mensaje = signal<string | null>(null);

  /** Selección para acciones en lote. */
  protected readonly seleccion = signal<Set<string>>(new Set());
  /** Medio con el que cobran el botón "Cobrar" de cada fila y el cobro en lote. */
  protected readonly medioLote = signal<MedioPago>('efectivo');

  /** Sesión abierta en el diálogo de detalle. */
  protected readonly detalle = signal<Prestacion | null>(null);

  protected readonly plata = plata;
  protected readonly nombreMedio = NOMBRE_MEDIO;
  protected readonly medios = MEDIOS;
  protected readonly nombreCobro = NOMBRE_COBRO;
  protected readonly claseCobro = CLASE_COBRO;
  protected readonly nombreAviso = NOMBRE_AVISO;
  protected readonly nombreLiquidacion = NOMBRE_LIQUIDACION;
  protected readonly colorDe = colorDisciplina;
  protected readonly colorMedio: Record<MedioPago, string> = {
    efectivo: 'var(--oc-ok)',
    transferencia: 'var(--oc-acento)',
    tarjeta: 'var(--oc-azul)',
    otro: 'var(--oc-lila)',
  };
  protected readonly inicialesDe = iniciales;

  protected readonly titulo = computed(() => nombreMes(this.mes()));
  protected readonly esMesActual = computed(() => this.mes() === this.hoy().slice(0, 7));
  /** "2026-11-05" → "05/11". */
  protected readonly diaMes = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

  protected readonly conteo = computed(() => {
    const c = { todos: 0, por_cobrar: 0, cobradas: 0, avisos: 0 };
    for (const p of this.prestaciones()) {
      c.todos++;
      if (p.estadoCobro === 'cobrada') c.cobradas++;
      else c.por_cobrar++;
      if (p.avisos.length) c.avisos++;
    }
    return c;
  });
  protected readonly filtros = computed(() => {
    const c = this.conteo();
    return [
      { id: 'todos' as const, texto: 'Todas', n: c.todos },
      { id: 'por_cobrar' as const, texto: 'Por cobrar', n: c.por_cobrar },
      { id: 'cobradas' as const, texto: 'Cobradas', n: c.cobradas },
      { id: 'avisos' as const, texto: 'Para revisar', n: c.avisos },
    ];
  });
  protected readonly filas = computed(() => {
    const f = this.filtro();
    const a = this.aviso();
    return this.prestaciones().filter((p) => {
      if (f === 'por_cobrar' && p.estadoCobro === 'cobrada') return false;
      if (f === 'cobradas' && p.estadoCobro !== 'cobrada') return false;
      if (f === 'avisos' && !p.avisos.length) return false;
      if (a && !p.avisos.includes(a as never)) return false;
      return true;
    });
  });
  protected readonly todasSeleccionadas = computed(
    () => this.filas().length > 0 && this.filas().every((p) => this.seleccion().has(p.id)),
  );

  /** Barras de "cobrado por medio", con porcentaje del total. */
  protected readonly porMedio = computed(() => {
    const r = this.resumen();
    const total = r?.cobrado ?? 0;
    return (r?.cobradoPorMedio ?? []).map((m) => ({
      ...m,
      nombre: NOMBRE_MEDIO[m.medio],
      pct: total ? Math.round((m.monto * 100) / total) : 0,
    }));
  });
  /** Barras de "cobrado por día", en proporción al día de más cobro. */
  protected readonly porDia = computed(() => {
    const dias = this.resumen()?.cobradoPorDia ?? [];
    const max = Math.max(1, ...dias.map((d) => d.monto));
    return dias.map((d) => ({ ...d, alto: Math.max(4, Math.round((d.monto * 100) / max)) }));
  });
  protected readonly porProfesional = computed(() => {
    const filas = this.resumen()?.porProfesional ?? [];
    const max = Math.max(1, ...filas.map((f) => f.facturado));
    return filas.map((f) => ({
      ...f,
      color: colorDisciplina(f.profesional.disciplina),
      ancho: Math.round((f.facturado * 100) / max),
    }));
  });
  protected readonly revisar = computed(() => {
    const c = this.conciliacion()?.conteo ?? {};
    return (Object.entries(c) as [keyof typeof NOMBRE_AVISO, number][])
      .filter(([, n]) => n > 0)
      .map(([tipo, n]) => ({ tipo, n, texto: NOMBRE_AVISO[tipo] }));
  });
  protected readonly retencionTexto = computed(() => {
    const pcts = [...new Set(this.liquidaciones().map((l) => l.retencionPorcentaje))];
    return pcts.length === 1
      ? `Retención del centro: ${pcts[0]}%`
      : 'Retención según cada profesional';
  });

  constructor() {
    // Recarga al cambiar de mes.
    effect(() => {
      const mes = this.mes();
      untracked(() => void this.cargar(mes));
    });
  }

  protected moverMes(n: number): void {
    this.mes.update((m) => sumarMes(m, n));
    this.seleccion.set(new Set());
    this.aviso.set(null);
  }

  protected elegirFiltro(f: Filtro): void {
    this.filtro.set(f);
    this.aviso.set(null);
  }

  protected filtrarAviso(tipo: string): void {
    if (tipo === 'sin_prestacion') return;
    this.seccion.set('cobros');
    this.filtro.set('avisos');
    this.aviso.set(this.aviso() === tipo ? null : tipo);
  }

  // ───────── Selección y lote ─────────

  protected alternar(id: string): void {
    this.seleccion.update((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected alternarTodas(): void {
    const ids = this.filas().map((p) => p.id);
    this.seleccion.set(this.todasSeleccionadas() ? new Set() : new Set(ids));
  }

  protected async cobrarSeleccion(): Promise<void> {
    const ids = [...this.seleccion()];
    await this.hacer(async () => {
      const r = await this.api.pagarLote(ids, this.medioLote());
      this.mensaje.set(
        r.pagos
          ? `Se cobraron ${r.pagos} ${r.pagos === 1 ? 'sesión' : 'sesiones'} por ${plata(r.total)}.`
          : 'Las sesiones elegidas no tenían saldo.',
      );
    });
  }

  protected async facturarSeleccion(facturada: boolean): Promise<void> {
    const ids = [...this.seleccion()];
    await this.hacer(async () => {
      const r = await this.api.facturar(ids, facturada);
      this.mensaje.set(
        `${r.actualizadas} ${r.actualizadas === 1 ? 'sesión marcada' : 'sesiones marcadas'} como ${facturada ? 'presentadas' : 'no presentadas'}.`,
      );
    });
  }

  protected async generarFaltantes(): Promise<void> {
    await this.hacer(async () => {
      const r = await this.api.generarFaltantes(this.mes());
      this.mensaje.set(
        `Se registraron ${r.creadas} ${r.creadas === 1 ? 'sesión' : 'sesiones'} para cobrar.` +
          (r.omitidas ? ` ${r.omitidas} quedaron afuera porque su mes ya está liquidado.` : ''),
      );
    });
  }

  // ───────── Cobro rápido y detalle ─────────

  /** "Cobrar" de la fila: el saldo, hoy, con el medio elegido arriba. */
  protected async cobrarRapido(p: Prestacion): Promise<void> {
    await this.hacer(() => this.api.pagar(p.id, { medio: this.medioLote() }));
  }

  protected abrir(p: Prestacion): void {
    this.detalle.set(p);
  }

  protected recargar(): void {
    void this.cargar(this.mes());
  }

  // ───────── Liquidación ─────────

  protected async generarLiquidacion(l: LiquidacionProfesional): Promise<void> {
    await this.hacer(() => this.liquidacionesApi.generar(l.profesional.id, this.mes()));
  }

  protected async pagarLiquidacion(l: LiquidacionProfesional): Promise<void> {
    if (l.liquidacion) await this.hacer(() => this.liquidacionesApi.pagar(l.liquidacion!.id));
  }

  protected async reabrirLiquidacion(l: LiquidacionProfesional): Promise<void> {
    if (l.liquidacion) await this.hacer(() => this.liquidacionesApi.reabrir(l.liquidacion!.id));
  }

  // ───────── Internos ─────────

  private async hacer(op: () => Promise<unknown>): Promise<void> {
    this.ocupado.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      await op();
      this.seleccion.set(new Set());
      await this.cargar(this.mes());
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  private async cargar(mes: string): Promise<void> {
    this.cargando.set(true);
    try {
      const [prestaciones, resumen, conciliacion, liquidaciones] = await Promise.all([
        this.api.prestaciones({ mes }),
        this.api.resumen(mes),
        this.api.conciliacion(mes),
        this.veLiquidacion() ? this.liquidacionesApi.listar(mes) : Promise.resolve([]),
      ]);
      if (mes !== this.mes()) return; // llegó tarde: ya se eligió otro mes
      this.prestaciones.set(prestaciones);
      this.resumen.set(resumen);
      this.conciliacion.set(conciliacion);
      this.liquidaciones.set(liquidaciones);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar los cobros del mes.'));
    } finally {
      this.cargando.set(false);
    }
  }
}

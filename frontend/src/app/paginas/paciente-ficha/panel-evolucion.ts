import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  HostListener,
  inject,
  input,
  model,
  OnDestroy,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensajeDeError, NotasApi } from '../../core/api/api';
import type { BorradorNota, Nota, SesionesNota } from '../../core/api/modelos';
import {
  estaVacio,
  etiquetaSesion,
  fechaYHora,
  GUIA,
  plantillaGuia,
  sesionPorDefecto,
  textoParaGuardar,
} from '../../core/expediente';

export type ModoPanel = 'inicio' | 'escribir';
/** Estado del borrador en el servidor mientras se escribe. */
type EstadoBorrador = 'nuevo' | 'pendiente' | 'guardado' | 'sin_conexion' | 'error';
type Confirmacion = 'descartar' | 'salir';

const CLAVE_GUIA = 'ci-expediente-guia';
const ESPERA_AUTOGUARDADO_MS = 1500;

function leerGuia(): boolean {
  try {
    return localStorage.getItem(CLAVE_GUIA) !== '0';
  } catch {
    return true;
  }
}

function guardarGuia(usar: boolean): void {
  try {
    localStorage.setItem(CLAVE_GUIA, usar ? '1' : '0');
  } catch {
    // Sin almacenamiento del navegador: queda la guía por defecto.
  }
}

function esSinConexion(e: unknown): boolean {
  return (e instanceof HttpErrorResponse && e.status === 0) || !navigator.onLine;
}

/**
 * Panel de nueva evolución: elegir la sesión, la guía de estructura opcional, el texto
 * y quién la ve. Mientras se escribe, el borrador se guarda solo en el servidor
 * (cifrado, solo para su autor); en el dispositivo no queda texto clínico.
 */
@Component({
  selector: 'app-panel-evolucion',
  imports: [FormsModule],
  templateUrl: './panel-evolucion.html',
  styleUrl: './panel-evolucion.scss',
  host: { '[class.abierto]': "modo() !== 'inicio'" },
})
export class PanelEvolucion implements OnDestroy {
  readonly pacienteId = input.required<string>();
  readonly sesiones = input<SesionesNota | null>(null);
  readonly zona = input.required<string>();
  readonly hoy = input.required<string>();
  readonly modo = model<ModoPanel>('inicio');
  /** El borrador del servidor: lo muestra la línea de tiempo cuando el panel está cerrado. */
  readonly borrador = model<BorradorNota | null>(null);

  readonly guardada = output<Nota>();
  readonly aviso = output<string>();

  private readonly api = inject(NotasApi);

  protected readonly guia = GUIA;
  protected readonly guiaAbierta = signal(false);
  protected readonly usarGuia = signal(leerGuia());
  protected readonly texto = signal('');
  protected readonly compartida = signal(false);
  protected readonly turnoId = signal<string | null>(null);
  protected readonly estado = signal<EstadoBorrador>('nuevo');
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmar = signal<Confirmacion | null>(null);
  private temporizador?: ReturnType<typeof setTimeout>;
  /** Hay cambios del borrador que todavía no llegaron al servidor. */
  private pendiente = false;

  protected readonly opcionesSesion = computed(() =>
    (this.sesiones()?.turnos ?? []).map((s) => ({
      id: s.id,
      texto: etiquetaSesion(s, this.hoy()),
    })),
  );

  protected readonly estadoTexto = computed(() => {
    switch (this.estado()) {
      case 'pendiente':
        return 'Guardando el borrador…';
      case 'guardado': {
        const b = this.borrador();
        return b
          ? `Borrador guardado · ${fechaYHora(b.actualizadoEn, this.zona(), this.hoy())}`
          : 'Borrador guardado';
      }
      case 'sin_conexion':
        return 'Sin conexión: el borrador se guarda cuando vuelva la señal.';
      case 'error':
        return 'No se pudo guardar el borrador. Se vuelve a intentar con el próximo cambio.';
      default:
        return 'Se guarda como borrador mientras escribís.';
    }
  });

  protected readonly estadoConAviso = computed(
    () => this.estado() === 'sin_conexion' || this.estado() === 'error',
  );

  ngOnDestroy(): void {
    // Si quedó un cambio esperando, se manda igual al salir de la ficha.
    clearTimeout(this.temporizador);
    if (this.pendiente && this.modo() === 'escribir') void this.guardarBorrador();
  }

  @HostListener('window:online')
  protected alVolverLaSenal(): void {
    if (this.pendiente && this.modo() === 'escribir') void this.guardarBorrador();
  }

  @HostListener('window:beforeunload', ['$event'])
  protected antesDeSalir(e: BeforeUnloadEvent): void {
    if (this.pendiente) e.preventDefault();
  }

  /** Abre el panel para escribir: sigue el borrador si hay, o empieza uno. */
  escribir(): void {
    const b = this.borrador();
    if (b) {
      this.texto.set(b.texto);
      this.compartida.set(b.compartida);
      this.turnoId.set(b.turnoId);
      this.estado.set('guardado');
    } else {
      this.texto.set(this.usarGuia() ? plantillaGuia() : '');
      this.compartida.set(false);
      this.turnoId.set(sesionPorDefecto(this.sesiones()?.turnos ?? [], this.hoy()));
      this.estado.set('nuevo');
    }
    this.error.set(null);
    this.modo.set('escribir');
    this.enfocar('texto-evolucion');
  }

  protected cambiarTexto(t: string): void {
    this.texto.set(t);
    this.programarGuardado();
  }

  protected elegirSesion(id: string): void {
    this.turnoId.set(id || null);
    this.programarGuardado();
  }

  protected ponerCompartida(compartida: boolean): void {
    this.compartida.set(compartida);
    this.programarGuardado();
  }

  protected cambiarUsoGuia(usar: boolean): void {
    this.usarGuia.set(usar);
    guardarGuia(usar);
  }

  private programarGuardado(): void {
    this.pendiente = true;
    this.estado.set('pendiente');
    clearTimeout(this.temporizador);
    this.temporizador = setTimeout(() => void this.guardarBorrador(), ESPERA_AUTOGUARDADO_MS);
  }

  private async guardarBorrador(): Promise<void> {
    this.pendiente = false;
    try {
      const r = await this.api.guardarBorrador(this.pacienteId(), {
        texto: this.texto(),
        compartida: this.compartida(),
        turnoId: this.turnoId(),
        origen: 'escrita',
      });
      this.borrador.set(r.borrador);
      if (!this.pendiente) this.estado.set('guardado');
    } catch (e) {
      this.pendiente = true;
      this.estado.set(esSinConexion(e) ? 'sin_conexion' : 'error');
    }
  }

  protected async guardar(): Promise<void> {
    if (estaVacio(this.texto())) {
      this.error.set('La evolución está vacía: escribí algo antes de guardar.');
      return;
    }
    clearTimeout(this.temporizador);
    this.guardando.set(true);
    this.error.set(null);
    try {
      const nota = await this.api.crear(this.pacienteId(), {
        texto: textoParaGuardar(this.texto()),
        compartida: this.compartida(),
        turnoId: this.turnoId(),
        origen: 'escrita',
      });
      // La API borra el borrador al guardar la evolución.
      this.pendiente = false;
      this.borrador.set(null);
      this.modo.set('inicio');
      this.guardada.emit(nota);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo guardar la evolución.'));
    } finally {
      this.guardando.set(false);
    }
  }

  /** Cerrar: el borrador queda en el servidor, salvo que no se haya podido guardar. */
  protected cerrar(): void {
    if (this.pendiente) {
      this.confirmar.set('salir');
      this.enfocar('confirmar-seguir');
      return;
    }
    this.modo.set('inicio');
    if (this.borrador()) this.aviso.emit('El borrador quedó guardado: lo seguís cuando quieras.');
  }

  protected pedirDescarte(): void {
    this.confirmar.set('descartar');
    this.enfocar('confirmar-seguir');
  }

  protected seguirEditando(): void {
    this.confirmar.set(null);
    this.enfocar('texto-evolucion');
  }

  protected async descartar(): Promise<void> {
    this.confirmar.set(null);
    clearTimeout(this.temporizador);
    this.pendiente = false;
    this.modo.set('inicio');
    try {
      await this.api.descartarBorrador(this.pacienteId());
      this.borrador.set(null);
      this.aviso.emit('Borrador descartado.');
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo descartar el borrador.'));
    }
  }

  private enfocar(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  }
}

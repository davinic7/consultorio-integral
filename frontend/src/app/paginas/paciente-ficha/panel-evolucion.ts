import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  computed,
  effect,
  HostListener,
  inject,
  input,
  model,
  OnDestroy,
  OnInit,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensajeDeError, NotasApi } from '../../core/api/api';
import type { BorradorNota, Nota, OrigenNota, SesionesNota } from '../../core/api/modelos';
import { DictadoService, type ResultadoDictado } from '../../core/dictado/dictado.service';
import {
  estaVacio,
  etiquetaSesion,
  fechaYHora,
  GUIA,
  plantillaGuia,
  sesionPorDefecto,
  sumarAlFinal,
  textoParaGuardar,
} from '../../core/expediente';
import { DictadoPanel } from './dictado-panel';

export type ModoPanel = 'inicio' | 'escribir' | 'dictar';
/** Estado del borrador en el servidor mientras se escribe. */
type EstadoBorrador = 'nuevo' | 'pendiente' | 'guardado' | 'sin_conexion' | 'error';
type Confirmacion = 'descartar' | 'salir' | 'grabacion';

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

/** Lo que el dictado sumó al final del borrador del servidor. */
function sumadoAlFinal(antes: string, despues: string): string {
  const base = antes.trimEnd();
  return despues.startsWith(base) ? despues.slice(base.length).trim() : despues.trim();
}

/**
 * Panel de nueva evolución: elegir la sesión, la guía de estructura opcional y
 * escribir o dictar, con el mismo peso. El borrador se guarda solo en el servidor
 * (cifrado, solo para su autor); lo dictado se transcribe allá y se suma al final
 * de ese borrador. En el dispositivo no queda texto clínico.
 */
@Component({
  selector: 'app-panel-evolucion',
  imports: [FormsModule, DictadoPanel],
  templateUrl: './panel-evolucion.html',
  styleUrl: './panel-evolucion.scss',
  host: { '[class.abierto]': "modo() !== 'inicio'" },
})
export class PanelEvolucion implements OnInit, OnDestroy {
  readonly pacienteId = input.required<string>();
  /** Nombre del paciente, para el dictado y la cola sin señal. */
  readonly nombrePaciente = input('');
  readonly sesiones = input<SesionesNota | null>(null);
  readonly zona = input.required<string>();
  readonly hoy = input.required<string>();
  readonly modo = model<ModoPanel>('inicio');
  /** El borrador del servidor: lo muestra la línea de tiempo cuando el panel está cerrado. */
  readonly borrador = model<BorradorNota | null>(null);

  readonly guardada = output<Nota>();
  readonly aviso = output<string>();

  private readonly api = inject(NotasApi);
  protected readonly dictado = inject(DictadoService);

  protected readonly guia = GUIA;
  protected readonly guiaAbierta = signal(false);
  protected readonly usarGuia = signal(leerGuia());
  protected readonly texto = signal('');
  protected readonly compartida = signal(false);
  protected readonly turnoId = signal<string | null>(null);
  protected readonly origen = signal<OrigenNota>('escrita');
  /** Palabras que el motor entendió con poca seguridad, para ir directo a corregirlas. */
  protected readonly dudosas = signal<string[]>([]);
  protected readonly avisoDictado = signal<string | null>(null);
  protected readonly estado = signal<EstadoBorrador>('nuevo');
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly confirmar = signal<Confirmacion | null>(null);
  private temporizador?: ReturnType<typeof setTimeout>;
  /** Hay cambios del borrador que todavía no llegaron al servidor. */
  private pendiente = false;
  private ultimoResultado = 0;

  /** Dicta quien escribe notas, con el plan que lo incluye, si el servidor puede transcribir. */
  protected readonly puedeDictar = computed(
    () => this.dictado.puedeDictar() && this.dictado.disponible() !== false,
  );

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

  constructor() {
    // Cuando termina un dictado de este paciente, su texto ya está en el borrador.
    effect(() => {
      const r = this.dictado.resultado();
      if (
        r &&
        r.n !== this.ultimoResultado &&
        r.pacienteId === untracked(() => this.pacienteId())
      ) {
        this.ultimoResultado = r.n;
        untracked(() => void this.alTerminarDictado(r));
      }
    });
  }

  ngOnInit(): void {
    // Se volvió a la ficha (por ejemplo, desde la píldora) con un dictado en curso.
    if (this.dictado.paciente()?.id === this.pacienteId() && this.dictado.ocupado()) {
      this.modo.set('dictar');
    }
    this.ultimoResultado = this.dictado.resultado()?.n ?? 0;
  }

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
    if (this.modo() === 'dictar') this.dictado.cerrar();
    const b = this.borrador();
    if (b) {
      this.cargar(b);
    } else {
      this.texto.set(this.usarGuia() ? plantillaGuia() : '');
      this.compartida.set(false);
      this.turnoId.set(sesionPorDefecto(this.sesiones()?.turnos ?? [], this.hoy()));
      this.origen.set('escrita');
      this.estado.set('nuevo');
    }
    this.error.set(null);
    this.avisoDictado.set(null);
    this.modo.set('escribir');
    this.enfocar('texto-evolucion');
  }

  /** Abre el dictado. Lo que haya escrito se guarda antes, para no pisarlo. */
  async dictar(): Promise<void> {
    if (this.pendiente) await this.guardarBorrador();
    const turno =
      this.modo() === 'escribir'
        ? this.turnoId()
        : (this.borrador()?.turnoId ?? sesionPorDefecto(this.sesiones()?.turnos ?? [], this.hoy()));
    this.avisoDictado.set(null);
    this.modo.set('dictar');
    await this.dictado.preparar({ id: this.pacienteId(), nombre: this.nombrePaciente() }, turno);
  }

  private cargar(b: BorradorNota): void {
    this.texto.set(b.texto);
    this.compartida.set(b.compartida);
    this.turnoId.set(b.turnoId);
    this.origen.set(b.origen);
    this.estado.set('guardado');
  }

  private async alTerminarDictado(r: ResultadoDictado): Promise<void> {
    const anterior = this.borrador();
    let nuevo: BorradorNota | null;
    try {
      nuevo = (await this.api.borrador(this.pacienteId())).borrador;
    } catch {
      return;
    }
    if (r.sinTexto || !nuevo) {
      if (this.modo() === 'dictar') {
        this.avisoDictado.set(
          'No se entendió nada en la grabación. Probá de nuevo más cerca del teléfono.',
        );
      }
      return;
    }
    if (this.modo() === 'escribir' && this.pendiente) {
      // Escribía mientras se transcribía: lo dictado se suma a lo suyo, sin pisarlo.
      this.texto.set(sumarAlFinal(this.texto(), sumadoAlFinal(anterior?.texto ?? '', nuevo.texto)));
      this.origen.set('dictada');
      this.dudosas.set(r.dudosas);
      void this.guardarBorrador();
      return;
    }
    this.borrador.set(nuevo);
    if (this.modo() === 'inicio') {
      this.aviso.emit('El dictado ya está en el borrador: abrilo para revisarlo.');
      return;
    }
    this.cargar(nuevo);
    this.dudosas.set(r.dudosas);
    this.dictado.cerrar();
    this.modo.set('escribir');
    this.enfocar('texto-evolucion');
  }

  /** "Para revisar": selecciona la palabra en el texto para corregirla. */
  protected irA(palabra: string): void {
    const area = document.getElementById('texto-evolucion') as HTMLTextAreaElement | null;
    if (!area) return;
    const desde = area.value.toLocaleLowerCase('es').indexOf(palabra.toLocaleLowerCase('es'));
    area.focus();
    if (desde >= 0) area.setSelectionRange(desde, desde + palabra.length);
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
    clearTimeout(this.temporizador);
    this.pendiente = false;
    try {
      const r = await this.api.guardarBorrador(this.pacienteId(), {
        texto: this.texto(),
        compartida: this.compartida(),
        turnoId: this.turnoId(),
        origen: this.origen(),
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
        origen: this.origen(),
      });
      // La API borra el borrador al guardar la evolución.
      this.pendiente = false;
      this.borrador.set(null);
      this.dudosas.set([]);
      this.modo.set('inicio');
      this.guardada.emit(nota);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo guardar la evolución.'));
    } finally {
      this.guardando.set(false);
    }
  }

  /**
   * Cerrar. Grabando: pide confirmar. Transcribiendo: sigue solo y avisa al terminar.
   * Escribiendo: el borrador queda en el servidor, salvo que no se haya podido guardar.
   */
  protected cerrar(): void {
    if (this.modo() === 'dictar') {
      const fase = this.dictado.fase();
      if (fase === 'grabando' || fase === 'pausado') return this.pedirDescarteGrabacion();
      if (this.dictado.ocupado()) {
        this.modo.set('inicio');
        this.aviso.emit('La transcripción sigue: el texto va a aparecer en el borrador.');
        return;
      }
      this.dictado.cerrar();
      this.modo.set('inicio');
      return;
    }
    if (this.pendiente) {
      this.confirmar.set('salir');
      this.enfocar('confirmar-seguir');
      return;
    }
    this.modo.set('inicio');
    if (this.borrador()) this.aviso.emit('El borrador quedó guardado: lo seguís cuando quieras.');
  }

  /** Desde el dictado: vuelve al expediente; lo que esté en curso sigue solo. */
  protected volverAlExpediente(): void {
    this.dictado.cerrar();
    this.modo.set('inicio');
  }

  protected pedirDescarte(): void {
    this.confirmar.set('descartar');
    this.enfocar('confirmar-seguir');
  }

  protected pedirDescarteGrabacion(): void {
    this.dictado.pausar();
    this.confirmar.set('grabacion');
    this.enfocar('confirmar-seguir');
  }

  protected seguirEditando(): void {
    const era = this.confirmar();
    this.confirmar.set(null);
    if (era === 'grabacion') {
      if (!this.dictado.pausaPorBloqueo()) this.dictado.reanudar();
      return;
    }
    this.enfocar('texto-evolucion');
  }

  protected async descartar(): Promise<void> {
    const era = this.confirmar();
    this.confirmar.set(null);
    if (era === 'grabacion') {
      this.dictado.descartarGrabacion();
      return;
    }
    clearTimeout(this.temporizador);
    this.pendiente = false;
    this.modo.set('inicio');
    try {
      await this.api.descartarBorrador(this.pacienteId());
      this.borrador.set(null);
      this.dudosas.set([]);
      this.aviso.emit('Borrador descartado.');
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo descartar el borrador.'));
    }
  }

  private enfocar(id: string): void {
    setTimeout(() => document.getElementById(id)?.focus(), 0);
  }
}

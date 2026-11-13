import { HttpErrorResponse } from '@angular/common/http';
import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { DictadoApi, mensajeDeError } from '../api/api';
import type { TrabajoDictado } from '../api/modelos';
import { AuthService } from '../auth/auth.service';
import { tieneModulo } from '../auth/modulos';
import { aWav16k } from './audio';
import { cifrarParaServidor, datosAdicionales } from './cifrado';
import {
  borrarPendiente,
  borrarPendientesDe,
  guardarPendiente,
  leerClave,
  listarPendientes,
  type Pendiente,
  recordarClave,
} from './cola';

/** Estados del dictado (docs/diseno/expediente-dictado.md, tabla 3). */
export type FaseDictado =
  | 'inactivo'
  | 'permiso'
  | 'negado'
  | 'listo'
  | 'grabando'
  | 'pausado'
  | 'enviando'
  | 'transcribiendo'
  | 'sin_conexion'
  | 'error'
  | 'no_disponible';

/** Máximo de un tramo y desde cuándo se avisa. */
export const MAX_SEGUNDOS = 600;
export const AVISO_SEGUNDOS = 540;
const MIN_SEGUNDOS = 0.5;
/** Fallas del servidor antes de dejar de reintentar solo (los cortes de señal no cuentan). */
const MAX_INTENTOS = 3;
/** Después de un corte, se vuelve a probar cada tanto: la señal puede volver sin aviso. */
const REINTENTO_MS = 30_000;
const CLAVE_EXPLICADO = 'ci-dictado-explicado';
const TIPOS = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'];

/** Avisa que un dictado terminó y su texto ya está en el borrador del paciente. */
export interface ResultadoDictado {
  pacienteId: string;
  dudosas: string[];
  sinTexto: boolean;
  n: number;
}

class ErrorDictado extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

function esCorte(e: unknown): boolean {
  return (e instanceof HttpErrorResponse && e.status === 0) || !navigator.onLine;
}

/**
 * Qué hace la cola con una grabación. La que está en pantalla esperando señal se
 * manda a la vista; si se está mandando o muestra un error, decide la persona; si
 * ya no está en pantalla, va en segundo plano como las demás.
 */
export function comoMandar(
  p: Pick<Pendiente, 'id' | 'intentos'>,
  enCurso: string | null,
  fase: FaseDictado,
): 'saltear' | 'en_pantalla' | 'segundo_plano' {
  if (p.intentos >= MAX_INTENTOS) return 'saltear';
  if (p.id !== enCurso) return 'segundo_plano';
  if (fase === 'sin_conexion') return 'en_pantalla';
  if (fase === 'enviando' || fase === 'transcribiendo' || fase === 'error') return 'saltear';
  return 'segundo_plano';
}

function vibrar(patron: number | number[]): void {
  try {
    navigator.vibrate?.(patron);
  } catch {
    // Sin vibración.
  }
}

function yaSeExplico(): boolean {
  try {
    return localStorage.getItem(CLAVE_EXPLICADO) === '1';
  } catch {
    return false;
  }
}

function marcarExplicado(): void {
  try {
    localStorage.setItem(CLAVE_EXPLICADO, '1');
  } catch {
    // Se vuelve a explicar la próxima vez.
  }
}

async function permisoMicrofono(): Promise<PermissionState | null> {
  try {
    return (await navigator.permissions.query({ name: 'microphone' as PermissionName })).state;
  } catch {
    return null;
  }
}

/**
 * El dictado de punta a punta en el navegador. Graba con MediaRecorder, convierte a
 * WAV 16 kHz, lo cifra con la clave pública de la persona (nadie en el teléfono lo
 * puede abrir), lo deja en la cola del dispositivo y lo sube. El servidor lo
 * transcribe y suma el texto al borrador del paciente: el texto nunca pasa por acá.
 * Apenas se transcribe bien, la grabación se borra del dispositivo.
 *
 * Es global (no de la pantalla): se puede seguir grabando o esperando la
 * transcripción mientras se mira otra parte del sistema.
 */
@Injectable({ providedIn: 'root' })
export class DictadoService {
  private readonly api = inject(DictadoApi);
  private readonly auth = inject(AuthService);

  readonly fase = signal<FaseDictado>('inactivo');
  /** Paciente del dictado en curso. */
  readonly paciente = signal<{ id: string; nombre: string } | null>(null);
  readonly segundos = signal(0);
  /** Nivel de la voz, de 0 a 1, para el anillo y las barras. */
  readonly nivel = signal(0);
  readonly pausaPorBloqueo = signal(false);
  /** Lo subido de la grabación, de 0 a 1. */
  readonly subida = signal(0);
  readonly trabajo = signal<TrabajoDictado | null>(null);
  readonly codigoError = signal<string | null>(null);
  readonly mensajeError = signal<string | null>(null);
  readonly pendientes = signal<Pendiente[]>([]);
  readonly resultado = signal<ResultadoDictado | null>(null);
  /** null: todavía no se preguntó al servidor. */
  readonly disponible = signal<boolean | null>(null);

  readonly casiLimite = computed(() => this.segundos() >= AVISO_SEGUNDOS);
  readonly ocupado = computed(() =>
    ['grabando', 'pausado', 'enviando', 'transcribiendo'].includes(this.fase()),
  );
  /** Escribe notas (profesional, o admin que atiende) y el plan incluye notas y dictado. */
  readonly puedeDictar = computed(() => {
    const s = this.auth.sesion();
    if (!s?.centro || !tieneModulo(s, 'notas') || !tieneModulo(s, 'dictado')) return false;
    return s.rol === 'profesional' || (s.rol === 'admin' && !!s.atiende);
  });

  private turnoId: string | null = null;
  private grabador?: MediaRecorder;
  private flujo?: MediaStream;
  private partes: Blob[] = [];
  private audio?: AudioContext;
  private analizador?: AnalyserNode;
  private cuadro = 0;
  private reloj?: ReturnType<typeof setInterval>;
  private inicioTramo = 0;
  private acumuladoMs = 0;
  private pantalla: WakeLockSentinel | null = null;
  /** Id de la grabación que se ve en pantalla (las demás van en segundo plano). */
  private enCurso: string | null = null;
  private procesandoCola = false;
  private reintento?: ReturnType<typeof setTimeout>;
  private contador = 0;

  constructor() {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => void this.procesarCola());
      window.addEventListener('beforeunload', (e) => {
        if (this.ocupado()) e.preventDefault();
      });
      document.addEventListener('visibilitychange', () => this.alCambiarVisibilidad());
    }
    // Con sesión y dictado habilitado, revisa si quedó algo pendiente de antes.
    effect(() => {
      if (this.puedeDictar()) untracked(() => void this.procesarCola());
    });
  }

  // ───────── Preparar y permiso ─────────

  /** Abre el dictado para un paciente: decide si hay que explicar o pedir el micrófono. */
  async preparar(paciente: { id: string; nombre: string }, turnoId: string | null): Promise<void> {
    if (this.ocupado()) return;
    this.paciente.set(paciente);
    this.turnoId = turnoId;
    this.limpiarError();
    if (this.disponible() === null) {
      try {
        this.disponible.set((await this.api.estado()).disponible);
      } catch (e) {
        // Sin señal se puede grabar igual: queda cifrado en la cola.
        if (!esCorte(e)) this.disponible.set(false);
      }
    }
    if (this.disponible() === false) {
      this.fase.set('no_disponible');
      return;
    }
    const permiso = await permisoMicrofono();
    if (permiso === 'denied') this.fase.set('negado');
    else if (permiso === 'granted' || yaSeExplico()) this.fase.set('listo');
    else this.fase.set('permiso');
  }

  /** "Permitir el micrófono": el navegador pregunta; se suelta enseguida. */
  async pedirPermiso(): Promise<void> {
    try {
      const flujo = await navigator.mediaDevices.getUserMedia({ audio: true });
      flujo.getTracks().forEach((t) => t.stop());
      marcarExplicado();
      this.fase.set('listo');
    } catch (e) {
      this.alFallarMicrofono(e);
    }
  }

  // ───────── Grabación ─────────

  async empezar(): Promise<void> {
    this.limpiarError();
    try {
      this.flujo = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch (e) {
      this.alFallarMicrofono(e);
      return;
    }
    marcarExplicado();
    this.partes = [];
    const tipo = TIPOS.find((t) => MediaRecorder.isTypeSupported?.(t));
    this.grabador = new MediaRecorder(this.flujo, tipo ? { mimeType: tipo } : undefined);
    this.grabador.ondataavailable = (e) => {
      if (e.data.size) this.partes.push(e.data);
    };
    this.grabador.start(1000);
    this.acumuladoMs = 0;
    this.inicioTramo = performance.now();
    this.segundos.set(0);
    this.pausaPorBloqueo.set(false);
    this.fase.set('grabando');
    this.medirNivel();
    this.reloj = setInterval(() => this.contar(), 250);
    void this.mantenerPantalla();
    vibrar(20);
  }

  pausar(): void {
    if (this.fase() !== 'grabando' || !this.grabador) return;
    if (this.grabador.state === 'recording') this.grabador.pause();
    this.acumuladoMs += performance.now() - this.inicioTramo;
    this.nivel.set(0);
    this.fase.set('pausado');
  }

  reanudar(): void {
    if (this.fase() !== 'pausado' || !this.grabador) return;
    if (this.grabador.state === 'paused') this.grabador.resume();
    this.inicioTramo = performance.now();
    this.pausaPorBloqueo.set(false);
    this.fase.set('grabando');
    void this.mantenerPantalla();
  }

  /** Descarta lo que se está grabando; no se guarda nada. */
  descartarGrabacion(): void {
    if (this.grabador && this.grabador.state !== 'inactive') {
      this.grabador.ondataavailable = null;
      this.grabador.stop();
    }
    this.partes = [];
    this.soltarMicrofono();
    this.segundos.set(0);
    this.fase.set('listo');
  }

  /** Termina el tramo: cifra, lo guarda en la cola del dispositivo y lo sube. */
  async terminar(): Promise<void> {
    const grabador = this.grabador;
    if (!grabador || (this.fase() !== 'grabando' && this.fase() !== 'pausado')) return;
    const detenido = new Promise<void>((r) => (grabador.onstop = () => r()));
    if (grabador.state !== 'inactive') grabador.stop();
    await detenido;
    const grabacion = new Blob(this.partes, { type: grabador.mimeType });
    this.partes = [];
    this.soltarMicrofono();
    vibrar([15, 60, 15]);
    this.fase.set('enviando');
    this.subida.set(0);
    try {
      const sesion = this.sesionActual();
      const paciente = this.paciente();
      if (!sesion || !paciente)
        throw new ErrorDictado('DI-00', 'La sesión cambió. Volvé a abrir el expediente.');
      let audio: Awaited<ReturnType<typeof aWav16k>>;
      try {
        audio = await aWav16k(grabacion);
      } catch {
        throw new ErrorDictado('AU-01', 'No se pudo leer la grabación de este navegador.');
      }
      if (audio.segundos < MIN_SEGUNDOS) {
        this.fase.set('listo');
        this.mensajeError.set('La grabación es demasiado corta.');
        return;
      }
      const clave = await this.claveParaCifrar(sesion.centroId, sesion.usuarioId);
      const paquete = await cifrarParaServidor(
        audio.wav,
        clave.clave,
        clave.version,
        datosAdicionales({ ...sesion, pacienteId: paciente.id }),
      );
      audio.wav.fill(0);
      const pendiente: Pendiente = {
        id: crypto.randomUUID(),
        ...sesion,
        pacienteId: paciente.id,
        turnoId: this.turnoId,
        duracionSeg: Math.round(audio.segundos),
        creadoEn: new Date().toISOString(),
        versionClave: clave.version,
        paquete: paquete.buffer,
        intentos: 0,
      };
      // Primero al dispositivo (cifrada): si se corta o se cierra la app, no se pierde.
      // Queda en pantalla antes de guardarla, así la cola no la manda dos veces.
      this.enCurso = pendiente.id;
      await guardarPendiente(pendiente);
      await this.enviar(pendiente, true);
    } catch (e) {
      this.mostrarError(e);
    }
  }

  // ───────── Envío, espera y cola ─────────

  /** Vuelve a mandar la grabación del error en pantalla, o lo que esperaba señal. */
  async reintentar(): Promise<void> {
    const id = this.enCurso;
    const sesion = this.sesionActual();
    if (!id || !sesion) return void this.procesarCola();
    const p = (await listarPendientes(sesion.centroId, sesion.usuarioId)).find((x) => x.id === id);
    if (!p) return void this.procesarCola();
    this.limpiarError();
    this.fase.set('enviando');
    await this.enviar(p, true);
  }

  /** Borra del dispositivo la grabación del error en pantalla. */
  async descartarPendiente(): Promise<void> {
    if (this.enCurso) await borrarPendiente(this.enCurso);
    this.enCurso = null;
    this.limpiarError();
    this.fase.set('listo');
    await this.refrescarPendientes();
  }

  /** Cierra el dictado en pantalla. Si está transcribiendo, sigue y avisa al terminar. */
  cerrar(): void {
    if (this.fase() === 'grabando' || this.fase() === 'pausado') return;
    if (!this.ocupado()) {
      // Lo que esperaba señal o mostraba un error pasa a la cola de segundo plano.
      this.enCurso = null;
      this.fase.set('inactivo');
      this.limpiarError();
    }
  }

  /** Manda lo que quedó esperando señal, de a uno. */
  async procesarCola(): Promise<void> {
    clearTimeout(this.reintento);
    this.reintento = undefined;
    const sesion = this.sesionActual();
    if (this.procesandoCola || !sesion || !navigator.onLine || !this.puedeDictar()) {
      await this.refrescarPendientes();
      return;
    }
    this.procesandoCola = true;
    try {
      for (const p of await listarPendientes(sesion.centroId, sesion.usuarioId)) {
        const como = comoMandar(p, this.enCurso, this.fase());
        if (como === 'saltear') continue;
        if (como === 'en_pantalla') {
          this.limpiarError();
          this.subida.set(0);
          this.fase.set('enviando');
        } else if (p.id === this.enCurso) {
          this.enCurso = null;
        }
        if (!(await this.enviar(p, como === 'en_pantalla'))) break;
      }
    } finally {
      this.procesandoCola = false;
      await this.refrescarPendientes();
    }
  }

  /** Al cerrar sesión se borran las grabaciones pendientes de esa persona. */
  async olvidarPendientes(): Promise<void> {
    const s = this.auth.sesion();
    if (s) await borrarPendientesDe(s.usuario.id);
    this.pendientes.set([]);
  }

  /** false si se cortó la señal (para no seguir con la cola). */
  private async enviar(p: Pendiente, enPantalla: boolean): Promise<boolean> {
    // Ya se había subido y se cortó mientras se transcribía: primero se consulta,
    // así el texto no llega dos veces al borrador.
    if (p.trabajoId) {
      if (enPantalla) this.fase.set('transcribiendo');
      const previo = await this.esperar(p.trabajoId, enPantalla);
      if (previo === 'corte') return this.alCortarse(enPantalla);
      if (previo !== 'perdido') {
        if (previo.estado === 'listo') return this.alTerminar(p, previo, enPantalla);
        p.trabajoId = undefined;
        await this.fallo(p, new ErrorDictado(previo.codigo ?? 'TR-09', ''), enPantalla);
        return true;
      }
      // El servidor ya no lo tiene (se reinició o pasó mucho tiempo): se sube de nuevo.
      p.trabajoId = undefined;
      await guardarPendiente(p);
      if (enPantalla) {
        this.subida.set(0);
        this.fase.set('enviando');
      }
    }
    let trabajo: TrabajoDictado;
    try {
      trabajo = await this.api.subir(p.pacienteId, new Uint8Array(p.paquete), p.turnoId, (f) => {
        if (enPantalla) this.subida.set(f);
      });
    } catch (e) {
      if (esCorte(e)) return this.alCortarse(enPantalla);
      await this.fallo(p, e, enPantalla);
      return true;
    }
    p.trabajoId = trabajo.id;
    await guardarPendiente(p);
    if (enPantalla) {
      this.trabajo.set(trabajo);
      this.fase.set('transcribiendo');
    }
    const fin = await this.esperar(trabajo.id, enPantalla);
    if (fin === 'corte') return this.alCortarse(enPantalla);
    if (fin === 'perdido' || fin.estado === 'error') {
      p.trabajoId = undefined;
      await this.fallo(
        p,
        fin === 'perdido'
          ? new ErrorDictado('TR-08', '')
          : new ErrorDictado(fin.codigo ?? 'TR-09', ''),
        enPantalla,
      );
      return true;
    }
    return this.alTerminar(p, fin, enPantalla);
  }

  /** Sin señal: la grabación sigue en el dispositivo y se vuelve a probar sola. */
  private async alCortarse(enPantalla: boolean): Promise<false> {
    if (enPantalla) this.fase.set('sin_conexion');
    await this.refrescarPendientes();
    // Además del aviso del navegador al volver la señal, que no siempre llega.
    this.reintento ??= setTimeout(() => void this.procesarCola(), REINTENTO_MS);
    return false;
  }

  private async alTerminar(p: Pendiente, fin: TrabajoDictado, enPantalla: boolean): Promise<true> {
    // Listo: el texto ya está en el borrador. La grabación se borra del dispositivo.
    await borrarPendiente(p.id);
    void this.api.descartar(fin.id).catch(() => undefined);
    this.resultado.set({
      pacienteId: p.pacienteId,
      dudosas: fin.dudosas,
      sinTexto: fin.sinTexto,
      n: ++this.contador,
    });
    if (enPantalla) {
      this.enCurso = null;
      this.trabajo.set(null);
      this.fase.set('listo');
    }
    await this.refrescarPendientes();
    return true;
  }

  private async esperar(
    id: string,
    enPantalla: boolean,
  ): Promise<TrabajoDictado | 'corte' | 'perdido'> {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1000));
      try {
        const t = await this.api.consultar(id);
        if (enPantalla) this.trabajo.set(t);
        if (t.estado === 'listo' || t.estado === 'error') return t;
      } catch (e) {
        if (esCorte(e)) return 'corte';
        // El servidor se reinició y perdió la cola: la grabación sigue en el dispositivo.
        if (e instanceof HttpErrorResponse && e.status === 404) return 'perdido';
        throw e;
      }
    }
  }

  private async fallo(p: Pendiente, e: unknown, enPantalla: boolean): Promise<void> {
    // Una grabación que el servidor no puede abrir no se va a poder abrir nunca.
    const definitivo = e instanceof HttpErrorResponse && (e.status === 400 || e.status === 413);
    p.intentos = definitivo ? MAX_INTENTOS : p.intentos + 1;
    await guardarPendiente(p);
    if (enPantalla) this.mostrarError(e);
    await this.refrescarPendientes();
  }

  private async claveParaCifrar(centroId: string, usuarioId: string) {
    try {
      const c = await this.api.clave();
      recordarClave(centroId, usuarioId, c);
      return c;
    } catch (e) {
      const guardada = esCorte(e) ? leerClave(centroId, usuarioId) : null;
      if (guardada) return guardada;
      if (esCorte(e)) {
        throw new ErrorDictado(
          'DI-01',
          'Sin señal y sin la clave para cifrar. Conectate una vez para habilitar el dictado en este teléfono.',
        );
      }
      throw e;
    }
  }

  private async refrescarPendientes(): Promise<void> {
    const s = this.sesionActual();
    this.pendientes.set(s ? await listarPendientes(s.centroId, s.usuarioId) : []);
  }

  private sesionActual(): { centroId: string; usuarioId: string } | null {
    const s = this.auth.sesion();
    return s?.centro ? { centroId: s.centro.id, usuarioId: s.usuario.id } : null;
  }

  // ───────── Errores ─────────

  private alFallarMicrofono(e: unknown): void {
    const nombre = (e as { name?: string } | null)?.name;
    if (nombre === 'NotAllowedError' || nombre === 'SecurityError') {
      this.fase.set('negado');
      return;
    }
    this.mostrarError(
      new ErrorDictado('MI-01', 'No se encontró un micrófono en este dispositivo.'),
    );
  }

  private mostrarError(e: unknown): void {
    this.soltarMicrofono();
    if (e instanceof ErrorDictado) {
      this.codigoError.set(e.codigo);
      this.mensajeError.set(e.message || null);
    } else if (e instanceof HttpErrorResponse) {
      this.codigoError.set(`HTTP-${e.status}`);
      this.mensajeError.set(mensajeDeError(e, 'No se pudo transcribir.'));
    } else {
      this.codigoError.set('DI-09');
      this.mensajeError.set(null);
    }
    this.fase.set('error');
  }

  private limpiarError(): void {
    this.codigoError.set(null);
    this.mensajeError.set(null);
  }

  // ───────── Micrófono, nivel, tiempo y pantalla ─────────

  private contar(): void {
    if (this.fase() !== 'grabando') return;
    const s = Math.floor((this.acumuladoMs + performance.now() - this.inicioTramo) / 1000);
    this.segundos.set(s);
    if (s >= MAX_SEGUNDOS) void this.terminar();
  }

  private medirNivel(): void {
    if (!this.flujo) return;
    try {
      this.audio = new AudioContext();
      this.analizador = this.audio.createAnalyser();
      this.analizador.fftSize = 512;
      this.audio.createMediaStreamSource(this.flujo).connect(this.analizador);
      const datos = new Float32Array(this.analizador.fftSize);
      let ultimo = 0;
      const medir = (t: number) => {
        if (!this.analizador) return;
        if (t - ultimo > 80) {
          ultimo = t;
          this.analizador.getFloatTimeDomainData(datos);
          let suma = 0;
          for (const x of datos) suma += x * x;
          const rms = Math.sqrt(suma / datos.length);
          this.nivel.set(this.fase() === 'grabando' ? Math.min(1, rms * 6) : 0);
        }
        this.cuadro = requestAnimationFrame(medir);
      };
      this.cuadro = requestAnimationFrame(medir);
    } catch {
      // Sin medidor de nivel: se graba igual.
    }
  }

  private async mantenerPantalla(): Promise<void> {
    try {
      this.pantalla ??= (await navigator.wakeLock?.request('screen')) ?? null;
      this.pantalla?.addEventListener('release', () => (this.pantalla = null));
    } catch {
      // El navegador no lo permite: la pantalla se puede apagar sola.
    }
  }

  private alCambiarVisibilidad(): void {
    if (document.hidden) {
      // Al bloquear la pantalla o cambiar de app el navegador puede cortar el
      // micrófono: lo grabado queda y al volver se ofrece reanudar o terminar.
      if (this.fase() === 'grabando') {
        this.pausar();
        this.pausaPorBloqueo.set(true);
      }
    } else {
      if (this.fase() === 'pausado' || this.fase() === 'grabando') void this.mantenerPantalla();
      // Al volver a la app, manda lo que haya quedado esperando.
      void this.procesarCola();
    }
  }

  private soltarMicrofono(): void {
    cancelAnimationFrame(this.cuadro);
    clearInterval(this.reloj);
    this.reloj = undefined;
    this.analizador = undefined;
    void this.audio?.close().catch(() => undefined);
    this.audio = undefined;
    this.flujo?.getTracks().forEach((t) => t.stop());
    this.flujo = undefined;
    this.grabador = undefined;
    this.nivel.set(0);
    void this.pantalla?.release().catch(() => undefined);
    this.pantalla = null;
  }
}

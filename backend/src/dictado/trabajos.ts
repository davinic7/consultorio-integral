import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ErrorMotor, type MotorTranscripcion } from './motor.js';
import { armarWav, FRECUENCIA, partir } from './wav.js';

export type EstadoTrabajo = 'en_cola' | 'transcribiendo' | 'listo' | 'error';

/** Quién pidió el dictado: solo esa persona, en ese centro, lo puede consultar. */
export interface Duenio {
  centroId: string;
  usuarioId: string;
}

/** Datos con los que el texto llega al borrador del paciente. */
export interface DatosTrabajo extends Duenio {
  pacienteId: string;
  profesionalId: string;
  turnoId: string | null;
}

interface Trabajo extends DatosTrabajo {
  id: string;
  duracionSeg: number;
  procesadoSeg: number;
  estado: EstadoTrabajo;
  dudosas: string[];
  codigo: string | null;
  /** No se entendió nada (silencio o ruido). */
  sinTexto: boolean;
  /** El audio. Se descarta apenas termina la transcripción, salga bien o mal. */
  muestras: Int16Array | null;
  terminado: number | null;
}

/** Lo que ve el teléfono. Sin texto: el texto va directo al borrador del servidor. */
export interface VistaTrabajo {
  id: string;
  estado: EstadoTrabajo;
  duracionSeg: number;
  procesadoSeg: number;
  /** Dictados en la cola antes que este. */
  antes: number;
  dudosas: string[];
  codigo: string | null;
  sinTexto: boolean;
}

export class ErrorCola extends Error {
  constructor(
    readonly motivo: 'cola_llena' | 'demasiados' | 'muy_seguido',
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** Suma el texto transcripto al borrador del paciente (cifrado, en la base). */
export type AlTranscribir = (t: DatosTrabajo, texto: string) => Promise<void>;

export interface OpcionesTrabajos {
  /** Dictados esperando en total. */
  maxEnCola?: number;
  /** Dictados sin terminar por persona. */
  maxPorPersona?: number;
  /** Dictados que una persona puede mandar por minuto. */
  maxPorMinuto?: number;
  /** Cuánto se guarda el resultado esperando que lo consulten. */
  vidaMs?: number;
  /** Revisa los vencidos cada minuto (en la app; en los tests no). */
  limpiezaAutomatica?: boolean;
}

/** Texto final de lo dicho antes: le da contexto al motor en la parte siguiente. */
function contexto(texto: string): string | undefined {
  return texto ? texto.slice(-200) : undefined;
}

/**
 * Cola de dictados en memoria. Se transcribe de a uno (el modelo usa mucha CPU y
 * memoria), en partes de hasta 28 s, y se informa cuánto audio va procesado. El
 * texto no queda acá: se suma al borrador del paciente, cifrado. El audio se
 * descarta al terminar. Si el servidor se reinicia, la grabación sigue cifrada en
 * el dispositivo y se vuelve a mandar.
 */
export class TrabajosDictado {
  private readonly log = new Logger('Dictado');
  private readonly trabajos = new Map<string, Trabajo>();
  private readonly cola: string[] = [];
  private readonly envios = new Map<string, number[]>();
  private procesando = false;
  private readonly reloj?: NodeJS.Timeout;
  private readonly maxEnCola: number;
  private readonly maxPorPersona: number;
  private readonly maxPorMinuto: number;
  private readonly vidaMs: number;

  constructor(
    private readonly motor: MotorTranscripcion,
    private readonly alTranscribir: AlTranscribir,
    opciones: OpcionesTrabajos = {},
  ) {
    this.maxEnCola = opciones.maxEnCola ?? 20;
    this.maxPorPersona = opciones.maxPorPersona ?? 3;
    this.maxPorMinuto = opciones.maxPorMinuto ?? 6;
    this.vidaMs = opciones.vidaMs ?? 15 * 60_000;
    if (opciones.limpiezaAutomatica) {
      this.reloj = setInterval(() => this.limpiarVencidos(), 60_000);
      this.reloj.unref();
    }
  }

  get disponible(): boolean {
    return this.motor.disponible;
  }

  detener(): void {
    if (this.reloj) clearInterval(this.reloj);
  }

  crear(
    datos: DatosTrabajo,
    muestras: Int16Array,
    ahora = Date.now(),
  ): VistaTrabajo {
    this.limpiarVencidos(ahora);
    const clave = `${datos.centroId}:${datos.usuarioId}`;
    const recientes = (this.envios.get(clave) ?? []).filter(
      (t) => ahora - t < 60_000,
    );
    if (recientes.length >= this.maxPorMinuto) {
      throw new ErrorCola(
        'muy_seguido',
        'Mandaste varios dictados seguidos. Esperá un minuto.',
      );
    }
    if (this.cola.length >= this.maxEnCola) {
      throw new ErrorCola(
        'cola_llena',
        'Hay muchos dictados esperando. Probá de nuevo en unos minutos.',
      );
    }
    const pendientes = [...this.trabajos.values()].filter(
      (t) =>
        this.esDe(t, datos) &&
        (t.estado === 'en_cola' || t.estado === 'transcribiendo'),
    ).length;
    if (pendientes >= this.maxPorPersona) {
      throw new ErrorCola(
        'demasiados',
        'Ya tenés dictados transcribiéndose. Esperá a que terminen.',
      );
    }
    this.envios.set(clave, [...recientes, ahora]);
    const trabajo: Trabajo = {
      ...datos,
      id: randomUUID(),
      duracionSeg: Math.round((muestras.length / FRECUENCIA) * 10) / 10,
      procesadoSeg: 0,
      estado: 'en_cola',
      dudosas: [],
      codigo: null,
      sinTexto: false,
      muestras,
      terminado: null,
    };
    this.trabajos.set(trabajo.id, trabajo);
    this.cola.push(trabajo.id);
    this.log.log(`dictado ${trabajo.id}: en cola (${trabajo.duracionSeg} s)`);
    // Cómo quedó al recibirlo; la cola empieza enseguida.
    const recibido = this.vista(trabajo);
    void this.procesar();
    return recibido;
  }

  /** null si no existe o es de otra persona (no se revela cuál de las dos). */
  consultar(id: string, duenio: Duenio): VistaTrabajo | null {
    this.limpiarVencidos();
    const t = this.trabajos.get(id);
    return t && this.esDe(t, duenio) ? this.vista(t) : null;
  }

  /** Borra el dictado (y su audio, si todavía estaba en la cola). */
  descartar(id: string, duenio: Duenio): boolean {
    const t = this.trabajos.get(id);
    if (!t || !this.esDe(t, duenio)) return false;
    this.soltarAudio(t);
    this.trabajos.delete(id);
    const enCola = this.cola.indexOf(id);
    if (enCola >= 0) this.cola.splice(enCola, 1);
    return true;
  }

  limpiarVencidos(ahora = Date.now()): void {
    for (const [id, t] of this.trabajos) {
      if (t.terminado !== null && ahora - t.terminado > this.vidaMs)
        this.trabajos.delete(id);
    }
    for (const [clave, tiempos] of this.envios) {
      if (tiempos.every((t) => ahora - t >= 60_000)) this.envios.delete(clave);
    }
  }

  private esDe(t: Trabajo, d: Duenio): boolean {
    return t.centroId === d.centroId && t.usuarioId === d.usuarioId;
  }

  private soltarAudio(t: Trabajo): void {
    t.muestras?.fill(0);
    t.muestras = null;
  }

  private vista(t: Trabajo): VistaTrabajo {
    const enCola = this.cola.indexOf(t.id);
    return {
      id: t.id,
      estado: t.estado,
      duracionSeg: t.duracionSeg,
      procesadoSeg: Math.round(t.procesadoSeg * 10) / 10,
      antes: enCola >= 0 ? enCola + (this.procesando ? 1 : 0) : 0,
      dudosas: t.dudosas,
      codigo: t.codigo,
      sinTexto: t.sinTexto,
    };
  }

  private async procesar(): Promise<void> {
    if (this.procesando) return;
    this.procesando = true;
    try {
      for (let id = this.cola.shift(); id; id = this.cola.shift()) {
        const t = this.trabajos.get(id);
        if (t?.muestras) await this.transcribir(t, t.muestras);
      }
    } finally {
      this.procesando = false;
    }
  }

  private async transcribir(t: Trabajo, muestras: Int16Array): Promise<void> {
    t.estado = 'transcribiendo';
    const inicio = Date.now();
    const partes = partir(muestras);
    try {
      let texto = '';
      const dudosas = new Set<string>();
      for (const parte of partes) {
        // Si lo descartaron mientras se transcribía, no sigue.
        if (!this.trabajos.has(t.id)) return;
        const r = await this.motor.transcribir(armarWav(parte), {
          prompt: contexto(texto),
        });
        if (r.texto) texto = texto ? `${texto} ${r.texto}` : r.texto;
        for (const d of r.dudosas) dudosas.add(d);
        t.procesadoSeg = Math.min(
          t.duracionSeg,
          t.procesadoSeg + parte.length / FRECUENCIA,
        );
      }
      if (!this.trabajos.has(t.id)) return;
      if (texto) {
        try {
          await this.alTranscribir(t, texto);
        } catch {
          throw new ErrorMotor(
            'TR-05',
            'No se pudo guardar el texto en el borrador',
          );
        }
      }
      t.sinTexto = !texto;
      t.dudosas = [...dudosas].slice(0, 8);
      t.procesadoSeg = t.duracionSeg;
      t.estado = 'listo';
      this.log.log(
        `dictado ${t.id}: listo en ${Date.now() - inicio} ms (${t.duracionSeg} s, ${partes.length} partes)`,
      );
    } catch (e) {
      t.estado = 'error';
      t.codigo = e instanceof ErrorMotor ? e.codigo : 'TR-09';
      this.log.warn(
        `dictado ${t.id}: error ${t.codigo} tras ${Date.now() - inicio} ms`,
      );
    } finally {
      this.soltarAudio(t);
      t.terminado = Date.now();
    }
  }
}

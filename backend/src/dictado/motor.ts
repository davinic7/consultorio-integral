import type { Env } from '../config/env.js';

/**
 * Motores de transcripción. En producción es Whisper corriendo en un servicio
 * propio (whisper.cpp server en la red privada, ver docs/decisiones.md §19 y §20):
 * el audio no sale de nuestra infraestructura. Fuera de producción hay un motor
 * simulado, para desarrollar y probar sin el modelo.
 */

export interface ResultadoMotor {
  texto: string;
  /** Palabras que el motor entendió con poca seguridad (para revisarlas). */
  dudosas: string[];
}

export interface MotorTranscripcion {
  readonly disponible: boolean;
  /** Transcribe un WAV PCM 16 bits mono 16 kHz. `prompt`: lo dicho justo antes, para dar contexto. */
  transcribir(
    wav: Uint8Array<ArrayBuffer>,
    opciones?: { prompt?: string },
  ): Promise<ResultadoMotor>;
}

/**
 * Falla del motor con un código corto. Los códigos van a los registros y a la
 * pantalla; nunca llevan texto ni audio.
 */
export class ErrorMotor extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

/** Sin motor configurado: el dictado figura como no disponible. */
export class MotorApagado implements MotorTranscripcion {
  readonly disponible = false;
  transcribir(): Promise<ResultadoMotor> {
    return Promise.reject(
      new ErrorMotor('TR-00', 'El dictado no está disponible'),
    );
  }
}

/** Devuelve un texto fijo. Solo desarrollo y tests: nunca en producción. */
export class MotorSimulado implements MotorTranscripcion {
  readonly disponible = true;
  constructor(private readonly demoraMs = 0) {}

  async transcribir(wav: Uint8Array<ArrayBuffer>): Promise<ResultadoMotor> {
    if (this.demoraMs) await new Promise((r) => setTimeout(r, this.demoraMs));
    const segundos = Math.max(0, wav.byteLength - 44) / 32_000;
    return {
      texto: `Texto de prueba del dictado: ${segundos.toFixed(1).replace('.', ',')} segundos de audio.`,
      dudosas: [],
    };
  }
}

type Fetch = (url: URL, init: RequestInit) => Promise<Response>;

/** Whisper (whisper.cpp server) en nuestra red privada. */
export class MotorWhisperServidor implements MotorTranscripcion {
  readonly disponible = true;
  constructor(
    private readonly url: string,
    private readonly pedir: Fetch = (u, i) => fetch(u, i),
    private readonly esperaMs = 180_000,
  ) {}

  async transcribir(
    wav: Uint8Array<ArrayBuffer>,
    opciones: { prompt?: string } = {},
  ): Promise<ResultadoMotor> {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'tramo.wav');
    form.append('language', 'es');
    form.append('response_format', 'verbose_json');
    form.append('temperature', '0');
    if (opciones.prompt) form.append('prompt', opciones.prompt);
    let res: Response;
    try {
      res = await this.pedir(new URL('/inference', this.url), {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(this.esperaMs),
      });
    } catch {
      throw new ErrorMotor('TR-01', 'El servicio de transcripción no responde');
    }
    if (!res.ok) {
      throw new ErrorMotor(
        'TR-02',
        `El servicio de transcripción respondió ${res.status}`,
      );
    }
    const json: unknown = await res.json().catch(() => null);
    if (!json || typeof json !== 'object') {
      throw new ErrorMotor(
        'TR-03',
        'El servicio de transcripción respondió algo inválido',
      );
    }
    return interpretarWhisper(json);
  }
}

interface RespuestaWhisper {
  text?: unknown;
  error?: unknown;
  segments?: {
    text?: unknown;
    words?: { word?: unknown; probability?: unknown }[];
  }[];
}

/** Marcas que Whisper agrega en silencios o ruidos: "[BLANK_AUDIO]", "[música]". */
const MARCAS = /\[[^\]]*\]/g;

/**
 * Respuesta `verbose_json` de whisper.cpp → texto y palabras dudosas. Si la versión
 * del servidor no informa la probabilidad de cada palabra, no hay dudosas.
 */
export function interpretarWhisper(
  json: object,
  umbral = 0.45,
): ResultadoMotor {
  const r = json as RespuestaWhisper;
  if (typeof r.error === 'string') {
    throw new ErrorMotor(
      'TR-02',
      'El servicio de transcripción no pudo procesar el audio',
    );
  }
  const segmentos = Array.isArray(r.segments) ? r.segments : [];
  const crudo =
    typeof r.text === 'string'
      ? r.text
      : segmentos
          .map((s) => (typeof s.text === 'string' ? s.text : ''))
          .join(' ');
  const texto = crudo.replace(MARCAS, ' ').replace(/\s+/g, ' ').trim();
  const dudosas: string[] = [];
  for (const s of segmentos) {
    for (const p of Array.isArray(s.words) ? s.words : []) {
      if (typeof p.word !== 'string' || typeof p.probability !== 'number')
        continue;
      const palabra = p.word
        .replace(MARCAS, '')
        .trim()
        .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      if (
        palabra.length >= 3 &&
        p.probability < umbral &&
        !dudosas.includes(palabra)
      ) {
        dudosas.push(palabra);
      }
    }
  }
  return { texto, dudosas: dudosas.slice(0, 8) };
}

/**
 * Elige el motor según el entorno. Sin DICTADO_MOTOR: simulado fuera de producción
 * y apagado en producción. El simulado en producción no se acepta: metería texto
 * falso en un expediente.
 */
export function crearMotor(
  env: Pick<Env, 'NODE_ENV' | 'DICTADO_MOTOR' | 'WHISPER_URL'>,
): MotorTranscripcion {
  const motor =
    env.DICTADO_MOTOR ??
    (env.NODE_ENV === 'production' ? 'apagado' : 'simulado');
  if (motor === 'whisper') {
    if (!env.WHISPER_URL)
      throw new Error('DICTADO_MOTOR=whisper necesita WHISPER_URL');
    return new MotorWhisperServidor(env.WHISPER_URL);
  }
  if (motor === 'simulado') {
    if (env.NODE_ENV === 'production') {
      throw new Error('DICTADO_MOTOR=simulado no se puede usar en producción');
    }
    return new MotorSimulado(env.NODE_ENV === 'test' ? 0 : 700);
  }
  return new MotorApagado();
}

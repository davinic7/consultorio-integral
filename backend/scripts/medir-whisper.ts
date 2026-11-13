/**
 * Medición del servicio de transcripción (etapa 4, paso 4): compara los modelos de
 * Whisper con una grabación de prueba, usando el mismo camino que la API (las mismas
 * partes de hasta 28 s, el mismo contexto y el mismo pedido al servidor).
 *
 *   npm run medir-whisper -- --url https://…onrender.com/abc123 --audio mi-voz.wav
 *
 * Opciones:
 *   --url         dirección del servicio, con su prefijo secreto si tiene (o WHISPER_URL).
 *   --audio       WAV PCM de 16 bits, mono, a 16 kHz (lo graba whisper/medicion/grabar.html).
 *   --modelos     separados por coma. Por defecto: small,large-v3-turbo.
 *   --referencia  el texto leído. Por defecto: whisper/medicion/texto-para-leer.txt.
 *   --terminos    términos a buscar. Por defecto: whisper/medicion/terminos.txt.
 *   --salida      además de mostrarlo, guarda el informe en ese archivo.
 *
 * El informe muestra el texto transcripto: usar SOLO grabaciones de prueba con texto
 * inventado, nunca el audio de una sesión real.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { ErrorMotor, MotorWhisperServidor } from '../src/dictado/motor.js';
import { contexto } from '../src/dictado/trabajos.js';
import {
  armarWav,
  ErrorAudio,
  FRECUENCIA,
  leerWav,
  partir,
} from '../src/dictado/wav.js';

/** Espera máxima de la API por cada parte (MotorWhisperServidor). */
const ESPERA_API_MS = 180_000;
/** Acá se espera más, para medir también lo que en la API daría error. */
const ESPERA_MEDICION_MS = 900_000;

const medicion = new URL('../../whisper/medicion/', import.meta.url);

const { values: opciones } = parseArgs({
  options: {
    url: { type: 'string' },
    audio: { type: 'string' },
    modelos: { type: 'string', default: 'small,large-v3-turbo' },
    referencia: { type: 'string' },
    terminos: { type: 'string' },
    salida: { type: 'string' },
  },
});

const direccion = opciones.url ?? process.env.WHISPER_URL;
if (!direccion || !opciones.audio) {
  console.error(
    'Uso: npm run medir-whisper -- --url https://…/prefijo --audio mi-voz.wav [--modelos small,large-v3-turbo] [--salida informe.md]',
  );
  process.exit(1);
}
const base = new URL(direccion.endsWith('/') ? direccion : `${direccion}/`);

// ───────── Comparación de textos ─────────

/** Minúsculas y sin puntuación: se comparan las palabras, no cómo se puntuó. */
function palabras(texto: string): string[] {
  return texto
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '');
}

/** Palabras cambiadas, faltantes o de más, sobre el total del texto leído. */
function errorDePalabras(leido: string[], transcripto: string[]): number {
  if (!leido.length) return 0;
  let anterior = Array.from({ length: transcripto.length + 1 }, (_, i) => i);
  for (let i = 1; i <= leido.length; i++) {
    const fila = [i];
    for (let j = 1; j <= transcripto.length; j++) {
      fila[j] = Math.min(
        anterior[j] + 1,
        fila[j - 1] + 1,
        anterior[j - 1] + (leido[i - 1] === transcripto[j - 1] ? 0 : 1),
      );
    }
    anterior = fila;
  }
  return anterior[transcripto.length] / leido.length;
}

/** Términos que no aparecen en el texto (sin mirar mayúsculas ni tildes). */
function terminosFaltantes(terminos: string[], texto: string): string[] {
  const donde = ` ${sinTildes(palabras(texto).join(' '))} `;
  return terminos.filter(
    (t) => !donde.includes(` ${sinTildes(palabras(t).join(' '))} `),
  );
}

// ───────── Pedidos al servicio ─────────

async function servicioListo(): Promise<boolean> {
  try {
    const r = await fetch(new URL('health', base), {
      signal: AbortSignal.timeout(10_000),
    });
    // 503 también vale: el servidor atiende aunque diga que está cargando un modelo.
    return r.ok || r.status === 503;
  } catch {
    return false;
  }
}

/** Espera a que el servicio responda (puede estar despertando o reiniciándose). */
async function esperarServicio(minutos: number): Promise<boolean> {
  const hasta = Date.now() + minutos * 60_000;
  while (Date.now() < hasta) {
    if (await servicioListo()) return true;
    await new Promise((r) => setTimeout(r, 5_000));
  }
  return false;
}

interface Memoria {
  rss_kb: number;
  contenedor_kb: number;
  limite_kb: number;
  hilos: number;
}

async function leerMemoria(): Promise<Memoria | null> {
  try {
    const r = await fetch(new URL(`/memoria.json?t=${Date.now()}`, base), {
      signal: AbortSignal.timeout(5_000),
    });
    if (!r.ok) return null;
    const m = (await r.json()) as Partial<Memoria>;
    return typeof m.rss_kb === 'number' ? (m as Memoria) : null;
  } catch {
    return null;
  }
}

const SIN_MODELO = 'la imagen no trae ese modelo';

/** Carga el modelo en el servicio. Devuelve los segundos que tardó, o el motivo. */
async function cargarModelo(modelo: string): Promise<number | string> {
  const form = new FormData();
  form.append('model', `/modelos/ggml-${modelo}.bin`);
  const inicio = Date.now();
  try {
    const r = await fetch(new URL('load', base), {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(600_000),
    });
    if (r.status === 400) return SIN_MODELO;
    if (!r.ok) return `el servicio respondió ${r.status}`;
  } catch {
    return 'el servicio dejó de responder mientras lo cargaba (¿se quedó sin memoria?)';
  }
  return (Date.now() - inicio) / 1000;
}

interface Resultado {
  modelo: string;
  problema?: string;
  cargaSeg?: number;
  partesSeg: number[];
  texto: string;
  dudosas: string[];
  memoriaMb?: number;
  contenedorMb?: number;
}

async function medir(modelo: string, partes: Int16Array[]): Promise<Resultado> {
  const r: Resultado = { modelo, partesSeg: [], texto: '', dudosas: [] };
  const carga = await cargarModelo(modelo);
  if (typeof carga === 'string') return { ...r, problema: carga };
  r.cargaSeg = carga;

  let memoria = 0;
  let contenedor = 0;
  const muestreo = setInterval(() => {
    void leerMemoria().then((m) => {
      if (!m) return;
      memoria = Math.max(memoria, m.rss_kb);
      contenedor = Math.max(contenedor, m.contenedor_kb);
    });
  }, 1_000);

  const motor = new MotorWhisperServidor(
    base.toString(),
    undefined,
    ESPERA_MEDICION_MS,
  );
  try {
    for (const [i, parte] of partes.entries()) {
      const inicio = Date.now();
      const parcial = await motor.transcribir(armarWav(parte), {
        prompt: contexto(r.texto),
      });
      r.partesSeg.push((Date.now() - inicio) / 1000);
      if (parcial.texto)
        r.texto = r.texto ? `${r.texto} ${parcial.texto}` : parcial.texto;
      for (const d of parcial.dudosas)
        if (!r.dudosas.includes(d)) r.dudosas.push(d);
      process.stderr.write(
        `  ${modelo}: parte ${i + 1} de ${partes.length} en ${n(r.partesSeg[i])} s\n`,
      );
    }
  } catch (e) {
    const codigo = e instanceof ErrorMotor ? e.codigo : 'TR-09';
    r.problema =
      codigo === 'TR-01'
        ? `el servicio dejó de responder en la parte ${r.partesSeg.length + 1} (¿se quedó sin memoria?)`
        : `error ${codigo} en la parte ${r.partesSeg.length + 1}`;
  } finally {
    clearInterval(muestreo);
  }
  if (memoria) r.memoriaMb = Math.round(memoria / 1024);
  if (contenedor) r.contenedorMb = Math.round(contenedor / 1024);
  return r;
}

// ───────── Informe ─────────

const n = (v: number, decimales = 1) => v.toFixed(decimales).replace('.', ',');

function informe(
  resultados: Resultado[],
  audioSeg: number,
  entorno: Memoria | null,
  leido: string[],
  terminos: string[],
): string {
  const lineas = [
    '# Medición de Whisper',
    '',
    `- Fecha: ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`,
    `- Grabación: ${n(audioSeg, 0)} s`,
  ];
  if (entorno) {
    lineas.push(
      `- Servicio: ${entorno.hilos} hilos${entorno.limite_kb ? `, ${Math.round(entorno.limite_kb / 1024)} MB de memoria` : ''}`,
    );
  } else {
    lineas.push(
      '- Servicio: no informa la memoria (mirarla en el panel de Render)',
    );
  }
  lineas.push(
    '',
    '| Modelo | Carga | Transcripción | Velocidad | Parte más lenta | 10 min de dictado | Memoria | Palabras con error | Términos sin reconocer |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  );
  for (const r of resultados) {
    if (!r.partesSeg.length) {
      lineas.push(
        `| ${r.modelo} | no se pudo medir: ${r.problema} | | | | | | | |`,
      );
      continue;
    }
    const total = r.partesSeg.reduce((a, b) => a + b, 0);
    const velocidad = r.problema ? null : audioSeg / total;
    const lenta = Math.max(...r.partesSeg);
    const faltan = terminosFaltantes(terminos, r.texto);
    lineas.push(
      [
        '',
        r.modelo,
        `${n(r.cargaSeg ?? 0)} s`,
        r.problema ? `incompleta: ${r.problema}` : `${n(total)} s`,
        velocidad ? `${n(velocidad)}× el tiempo real` : '—',
        `${n(lenta)} s${lenta * 1000 > ESPERA_API_MS ? ' (la API cortaría a los 180 s)' : ''}`,
        velocidad ? `${n(600 / velocidad / 60)} min` : '—',
        r.memoriaMb
          ? `${r.memoriaMb} MB${r.contenedorMb ? ` (contenedor: ${r.contenedorMb} MB)` : ''}`
          : '—',
        leido.length && !r.problema
          ? `${n(errorDePalabras(leido, palabras(r.texto)) * 100)} %`
          : '—',
        terminos.length && !r.problema
          ? `${faltan.length} de ${terminos.length}`
          : '—',
        '',
      ]
        .join(' | ')
        .trim(),
    );
  }
  for (const r of resultados) {
    if (!r.partesSeg.length) continue;
    const faltan = terminosFaltantes(terminos, r.texto);
    lineas.push('', `## ${r.modelo}`, '');
    lineas.push(
      `- Segundos por parte: ${r.partesSeg.map((s) => n(s)).join(' · ')}`,
    );
    if (terminos.length && !r.problema)
      lineas.push(
        `- Términos sin reconocer: ${faltan.length ? faltan.join(', ') : 'ninguno'}`,
      );
    lineas.push(
      `- Palabras que marcó como dudosas: ${r.dudosas.length ? r.dudosas.join(', ') : 'ninguna'}`,
      '',
      r.texto || '(sin texto)',
    );
  }
  return `${lineas.join('\n')}\n`;
}

async function leerOpcional(ruta: string | undefined, porDefecto: string) {
  try {
    return await readFile(ruta ?? new URL(porDefecto, medicion), 'utf8');
  } catch {
    if (ruta) throw new Error(`No se pudo leer ${ruta}`);
    return '';
  }
}

async function principal(): Promise<void> {
  let muestras: Int16Array;
  try {
    muestras = leerWav(await readFile(opciones.audio!));
  } catch (e) {
    console.error(
      e instanceof ErrorAudio
        ? `${e.message}. Grabalo con whisper/medicion/grabar.html.`
        : `No se pudo leer ${opciones.audio}.`,
    );
    process.exit(1);
  }
  const audioSeg = muestras.length / FRECUENCIA;
  const partes = partir(muestras);
  const leido = palabras(
    await leerOpcional(opciones.referencia, 'texto-para-leer.txt'),
  );
  const terminos = (await leerOpcional(opciones.terminos, 'terminos.txt'))
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);

  process.stderr.write(
    `Grabación de ${n(audioSeg, 0)} s en ${partes.length} partes. Esperando al servicio…\n`,
  );
  if (!(await esperarServicio(10))) {
    console.error(
      'El servicio no responde. Revisá la dirección (con su prefijo secreto) y que esté en marcha.',
    );
    process.exit(1);
  }

  const resultados: Resultado[] = [];
  let entorno: Memoria | null = null;
  for (const modelo of opciones.modelos.split(',').map((m) => m.trim())) {
    if (!/^[a-z0-9._-]+$/i.test(modelo)) continue;
    process.stderr.write(`Modelo ${modelo}: cargando…\n`);
    const r = await medir(modelo, partes);
    resultados.push(r);
    entorno = (await leerMemoria()) ?? entorno;
    if (r.problema) {
      process.stderr.write(`  ${modelo}: ${r.problema}\n`);
      if (r.problema === SIN_MODELO) continue;
      // Si se cayó, Render lo levanta de nuevo: se espera para seguir con el próximo.
      if (!(await esperarServicio(10))) break;
    }
  }

  const texto = informe(resultados, audioSeg, entorno, leido, terminos);
  console.log(`\n${texto}`);
  if (opciones.salida) {
    await writeFile(opciones.salida, texto, 'utf8');
    process.stderr.write(`Informe guardado en ${opciones.salida}\n`);
  }
}

await principal();

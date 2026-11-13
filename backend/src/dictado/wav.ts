/**
 * Audio del dictado. El navegador lo manda como WAV PCM de 16 bits, mono, a 16 kHz
 * (lo que usa Whisper), así el servidor no necesita decodificar otros formatos.
 * El audio vive solo en memoria mientras se transcribe.
 */

export const FRECUENCIA = 16_000;
/** Máximo de un tramo de dictado: 10 minutos. */
export const MAX_SEGUNDOS = 600;
/** Margen sobre el máximo, por redondeos del navegador al cortar la grabación. */
const MARGEN_SEGUNDOS = 5;
const CABECERA = 44;
export const MAX_BYTES =
  CABECERA + (MAX_SEGUNDOS + MARGEN_SEGUNDOS) * FRECUENCIA * 2;

/** Audio que no se puede usar. El mensaje se puede mostrar: no tiene datos de nadie. */
export class ErrorAudio extends Error {}

function texto4(vista: DataView, desde: number): string {
  return String.fromCharCode(
    vista.getUint8(desde),
    vista.getUint8(desde + 1),
    vista.getUint8(desde + 2),
    vista.getUint8(desde + 3),
  );
}

/** WAV PCM 16 bits mono 16 kHz → muestras. Cualquier otro formato se rechaza. */
export function leerWav(bytes: Uint8Array): Int16Array {
  if (bytes.byteLength < CABECERA) throw new ErrorAudio('El audio está vacío');
  const vista = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (texto4(vista, 0) !== 'RIFF' || texto4(vista, 8) !== 'WAVE') {
    throw new ErrorAudio('El audio no es un WAV');
  }
  let formatoOk = false;
  let datos: { desde: number; largo: number } | null = null;
  let pos = 12;
  while (pos + 8 <= bytes.byteLength) {
    const id = texto4(vista, pos);
    const largo = vista.getUint32(pos + 4, true);
    const cuerpo = pos + 8;
    if (id === 'fmt ') {
      if (largo < 16 || cuerpo + 16 > bytes.byteLength) {
        throw new ErrorAudio('El audio tiene una cabecera inválida');
      }
      const formato = vista.getUint16(cuerpo, true);
      const canales = vista.getUint16(cuerpo + 2, true);
      const frecuencia = vista.getUint32(cuerpo + 4, true);
      const bits = vista.getUint16(cuerpo + 14, true);
      if (
        formato !== 1 ||
        canales !== 1 ||
        frecuencia !== FRECUENCIA ||
        bits !== 16
      ) {
        throw new ErrorAudio(
          'El audio tiene que ser PCM de 16 bits, mono, a 16 kHz',
        );
      }
      formatoOk = true;
    } else if (id === 'data') {
      datos = {
        desde: cuerpo,
        largo: Math.min(largo, bytes.byteLength - cuerpo),
      };
      break;
    }
    pos = cuerpo + largo + (largo % 2);
  }
  if (!formatoOk || !datos)
    throw new ErrorAudio('El audio tiene una cabecera inválida');
  const muestras = new Int16Array(Math.floor(datos.largo / 2));
  for (let i = 0; i < muestras.length; i++) {
    muestras[i] = vista.getInt16(datos.desde + i * 2, true);
  }
  return muestras;
}

/** Muestras → WAV PCM 16 bits mono 16 kHz (para mandar cada parte al motor). */
export function armarWav(muestras: Int16Array): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(CABECERA + muestras.length * 2));
  const vista = new DataView(bytes.buffer);
  const escribir = (desde: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      vista.setUint8(desde + i, s.charCodeAt(i));
  };
  escribir(0, 'RIFF');
  vista.setUint32(4, 36 + muestras.length * 2, true);
  escribir(8, 'WAVE');
  escribir(12, 'fmt ');
  vista.setUint32(16, 16, true);
  vista.setUint16(20, 1, true); // PCM
  vista.setUint16(22, 1, true); // mono
  vista.setUint32(24, FRECUENCIA, true);
  vista.setUint32(28, FRECUENCIA * 2, true);
  vista.setUint16(32, 2, true);
  vista.setUint16(34, 16, true);
  escribir(36, 'data');
  vista.setUint32(40, muestras.length * 2, true);
  for (let i = 0; i < muestras.length; i++)
    vista.setInt16(CABECERA + i * 2, muestras[i], true);
  return bytes;
}

/**
 * Parte el audio en pedazos de hasta `maxSegundos` (Whisper trabaja en ventanas
 * de 30 s), cortando en el momento más silencioso de los últimos `ventanaSegundos`
 * de cada pedazo para no partir una palabra. Devuelve vistas, sin copiar.
 */
export function partir(
  muestras: Int16Array,
  maxSegundos = 28,
  ventanaSegundos = 4,
): Int16Array[] {
  const max = maxSegundos * FRECUENCIA;
  const ventana = Math.min(ventanaSegundos * FRECUENCIA, max);
  const cuadro = FRECUENCIA / 50; // 20 ms
  const partes: Int16Array[] = [];
  let inicio = 0;
  while (muestras.length - inicio > max) {
    let corte = inicio + max;
    let menor = Number.POSITIVE_INFINITY;
    for (
      let c = inicio + max - ventana;
      c + cuadro <= inicio + max;
      c += cuadro
    ) {
      let energia = 0;
      for (let i = c; i < c + cuadro; i++) energia += muestras[i] * muestras[i];
      if (energia < menor) {
        menor = energia;
        corte = c + cuadro / 2;
      }
    }
    partes.push(muestras.subarray(inicio, corte));
    inicio = corte;
  }
  if (muestras.length > inicio) partes.push(muestras.subarray(inicio));
  return partes;
}

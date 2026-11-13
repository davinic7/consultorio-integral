/**
 * Audio del dictado en el navegador. El servidor recibe WAV PCM de 16 bits, mono,
 * a 16 kHz (lo que usa Whisper): acá se convierte lo que grabó MediaRecorder
 * (webm u mp4, según el navegador) antes de cifrarlo.
 */

export const FRECUENCIA = 16_000;

/** Muestras en [-1, 1] → WAV PCM 16 bits mono a la frecuencia dada. */
export function codificarWav(
  muestras: Float32Array,
  frecuencia = FRECUENCIA,
): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(44 + muestras.length * 2));
  const v = new DataView(bytes.buffer);
  const texto = (desde: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(desde + i, s.charCodeAt(i));
  };
  texto(0, 'RIFF');
  v.setUint32(4, 36 + muestras.length * 2, true);
  texto(8, 'WAVE');
  texto(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, frecuencia, true);
  v.setUint32(28, frecuencia * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  texto(36, 'data');
  v.setUint32(40, muestras.length * 2, true);
  for (let i = 0; i < muestras.length; i++) {
    const m = Math.max(-1, Math.min(1, muestras[i]));
    v.setInt16(44 + i * 2, m < 0 ? m * 0x8000 : m * 0x7fff, true);
  }
  return bytes;
}

/**
 * Lo grabado → WAV a 16 kHz mono. Decodifica con el propio navegador y lo
 * remuestrea con un OfflineAudioContext; funciona sin conexión.
 */
export async function aWav16k(
  grabacion: Blob,
): Promise<{ wav: Uint8Array<ArrayBuffer>; segundos: number }> {
  const contexto = new AudioContext();
  try {
    const original = await contexto.decodeAudioData(await grabacion.arrayBuffer());
    const largo = Math.max(1, Math.ceil(original.duration * FRECUENCIA));
    const offline = new OfflineAudioContext(1, largo, FRECUENCIA);
    const fuente = offline.createBufferSource();
    fuente.buffer = original;
    fuente.connect(offline.destination);
    fuente.start();
    const remuestreado = await offline.startRendering();
    return { wav: codificarWav(remuestreado.getChannelData(0)), segundos: original.duration };
  } finally {
    void contexto.close();
  }
}

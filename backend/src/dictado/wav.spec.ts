import { wavDePrueba } from '../../test/dictado-navegador.js';
import { armarWav, ErrorAudio, FRECUENCIA, leerWav, partir } from './wav.js';

describe('audio del dictado', () => {
  it('lee el WAV que arma el navegador y lo vuelve a armar igual', () => {
    const wav = wavDePrueba(0.25);
    const muestras = leerWav(wav);
    expect(muestras.length).toBe(FRECUENCIA / 4);
    expect(Buffer.from(armarWav(muestras))).toEqual(Buffer.from(wav));
  });

  it('rechaza otros formatos', () => {
    const estereo = wavDePrueba(0.1);
    new DataView(estereo.buffer).setUint16(22, 2, true);
    expect(() => leerWav(estereo)).toThrow(ErrorAudio);
    const a44k = wavDePrueba(0.1);
    new DataView(a44k.buffer).setUint32(24, 44_100, true);
    expect(() => leerWav(a44k)).toThrow(/16 kHz/);
    expect(() => leerWav(new Uint8Array(100))).toThrow(/no es un WAV/);
  });

  it('parte el audio largo en pedazos de hasta 28 s, cortando en el silencio', () => {
    const muestras = new Int16Array(70 * FRECUENCIA).fill(2000);
    // Un silencio a los 26 s: ahí tiene que cortar el primer pedazo.
    muestras.fill(0, 26 * FRECUENCIA, 26 * FRECUENCIA + FRECUENCIA / 10);
    const partes = partir(muestras);
    expect(partes.length).toBe(3);
    expect(partes.every((p) => p.length <= 28 * FRECUENCIA)).toBe(true);
    expect(partes.reduce((s, p) => s + p.length, 0)).toBe(muestras.length);
    const corte = partes[0].length / FRECUENCIA;
    expect(corte).toBeGreaterThanOrEqual(26);
    expect(corte).toBeLessThanOrEqual(26.1);
  });

  it('el audio corto queda en un solo pedazo', () => {
    expect(partir(new Int16Array(5 * FRECUENCIA))).toHaveLength(1);
  });
});

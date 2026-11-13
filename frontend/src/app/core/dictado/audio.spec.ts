import { codificarWav } from './audio';

describe('audio del dictado', () => {
  it('arma un WAV PCM de 16 bits, mono, a 16 kHz', () => {
    const wav = codificarWav(new Float32Array([0, 0.5, -0.5, 1, -1]));
    const v = new DataView(wav.buffer);
    const texto = (desde: number) => String.fromCharCode(...wav.slice(desde, desde + 4));
    expect(texto(0)).toBe('RIFF');
    expect(texto(8)).toBe('WAVE');
    expect(v.getUint16(20, true)).toBe(1); // PCM
    expect(v.getUint16(22, true)).toBe(1); // mono
    expect(v.getUint32(24, true)).toBe(16_000);
    expect(v.getUint16(34, true)).toBe(16);
    expect(v.getUint32(40, true)).toBe(10);
    expect(wav.length).toBe(44 + 10);
    expect([0, 1, 2, 3, 4].map((i) => v.getInt16(44 + i * 2, true))).toEqual([
      0, 16383, -16384, 32767, -32768,
    ]);
  });

  it('recorta lo que se pasa de rango en vez de deformarlo', () => {
    const v = new DataView(codificarWav(new Float32Array([3, -3])).buffer);
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });
});

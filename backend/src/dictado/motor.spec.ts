import { armarWav } from './wav.js';
import {
  crearMotor,
  ErrorMotor,
  interpretarWhisper,
  MotorApagado,
  MotorSimulado,
  MotorWhisperServidor,
} from './motor.js';

describe('motores de transcripción', () => {
  it('interpreta la respuesta de whisper.cpp y marca las palabras dudosas', () => {
    const r = interpretarWhisper({
      text: ' Trabajamos [BLANK_AUDIO] praxias linguales. ',
      segments: [
        {
          words: [
            { word: ' Trabajamos', probability: 0.98 },
            { word: ' praxias', probability: 0.31 },
            { word: ' linguales.', probability: 0.4 },
            { word: ' de', probability: 0.1 },
          ],
        },
      ],
    });
    expect(r).toEqual({
      texto: 'Trabajamos praxias linguales.',
      dudosas: ['praxias', 'linguales'],
    });
  });

  it('sin probabilidades por palabra no hay dudosas; un error del servidor es TR-02', () => {
    expect(interpretarWhisper({ text: 'Hola' })).toEqual({
      texto: 'Hola',
      dudosas: [],
    });
    expect(() => interpretarWhisper({ error: 'failed' })).toThrow(ErrorMotor);
  });

  it('manda el WAV a whisper.cpp en castellano y traduce las fallas a códigos', async () => {
    const pedidos: { url: string; form: FormData }[] = [];
    const ok = new MotorWhisperServidor(
      'http://whisper:8080',
      async (url, init) => {
        pedidos.push({ url: url.toString(), form: init.body as FormData });
        return new Response(JSON.stringify({ text: 'Listo' }), { status: 200 });
      },
    );
    await expect(
      ok.transcribir(armarWav(new Int16Array(16)), { prompt: 'antes' }),
    ).resolves.toEqual({
      texto: 'Listo',
      dudosas: [],
    });
    expect(pedidos[0].url).toBe('http://whisper:8080/inference');
    expect(pedidos[0].form.get('language')).toBe('es');
    expect(pedidos[0].form.get('prompt')).toBe('antes');

    // Con prefijo en la dirección (el --request-path del servidor), se respeta.
    for (const base of [
      'http://whisper:8080/abc123',
      'http://whisper:8080/abc123/',
    ]) {
      const conPrefijo = new MotorWhisperServidor(base, async (url) => {
        pedidos.push({ url: url.toString(), form: new FormData() });
        return new Response(JSON.stringify({ text: 'Listo' }), { status: 200 });
      });
      await conPrefijo.transcribir(armarWav(new Int16Array(16)));
      expect(pedidos.at(-1)?.url).toBe('http://whisper:8080/abc123/inference');
    }

    const caido = new MotorWhisperServidor('http://whisper:8080', async () => {
      throw new Error('ECONNREFUSED');
    });
    await expect(
      caido.transcribir(armarWav(new Int16Array(16))),
    ).rejects.toMatchObject({ codigo: 'TR-01' });
    const falla = new MotorWhisperServidor(
      'http://whisper:8080',
      async () => new Response('x', { status: 500 }),
    );
    await expect(
      falla.transcribir(armarWav(new Int16Array(16))),
    ).rejects.toMatchObject({ codigo: 'TR-02' });
  });

  it('elige el motor según el entorno y nunca simula en producción', () => {
    expect(crearMotor({ NODE_ENV: 'development' })).toBeInstanceOf(
      MotorSimulado,
    );
    expect(crearMotor({ NODE_ENV: 'production' })).toBeInstanceOf(MotorApagado);
    expect(
      crearMotor({
        NODE_ENV: 'production',
        DICTADO_MOTOR: 'whisper',
        WHISPER_URL: 'http://w:8080',
      }),
    ).toBeInstanceOf(MotorWhisperServidor);
    expect(() =>
      crearMotor({ NODE_ENV: 'production', DICTADO_MOTOR: 'simulado' }),
    ).toThrow(/producción/);
    expect(() =>
      crearMotor({ NODE_ENV: 'development', DICTADO_MOTOR: 'whisper' }),
    ).toThrow(/WHISPER_URL/);
  });
});

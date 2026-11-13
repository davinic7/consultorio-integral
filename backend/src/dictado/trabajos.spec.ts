import {
  ErrorMotor,
  type MotorTranscripcion,
  type ResultadoMotor,
} from './motor.js';
import { type DatosTrabajo, ErrorCola, TrabajosDictado } from './trabajos.js';
import { FRECUENCIA } from './wav.js';

const DATOS: DatosTrabajo = {
  centroId: 'c1',
  usuarioId: 'u1',
  pacienteId: 'p1',
  profesionalId: 'pr1',
  turnoId: null,
};

/** Motor que espera a que el test lo suelte. */
function motorControlado(
  resultado: ResultadoMotor | Error = { texto: 'Hola', dudosas: [] },
) {
  const pedidos: (() => void)[] = [];
  const motor: MotorTranscripcion = {
    disponible: true,
    transcribir: () =>
      new Promise<ResultadoMotor>((resolve, reject) => {
        pedidos.push(() =>
          resultado instanceof Error ? reject(resultado) : resolve(resultado),
        );
      }),
  };
  return {
    motor,
    soltar: async () => {
      pedidos.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const audio = (segundos: number) =>
  new Int16Array(segundos * FRECUENCIA).fill(1000);

describe('cola de dictados', () => {
  it('transcribe, suma el texto al borrador y descarta el audio', async () => {
    const { motor, soltar } = motorControlado({
      texto: 'Motivo: control.',
      dudosas: ['praxias'],
    });
    const alTranscribir = vi.fn().mockResolvedValue(undefined);
    const cola = new TrabajosDictado(motor, alTranscribir);
    const muestras = audio(2);
    const { id, estado } = cola.crear(DATOS, muestras);
    expect(estado).toBe('en_cola');
    expect(cola.consultar(id, DATOS)?.estado).toBe('transcribiendo');
    await soltar();
    expect(alTranscribir).toHaveBeenCalledWith(
      expect.objectContaining(DATOS),
      'Motivo: control.',
    );
    expect(cola.consultar(id, DATOS)).toMatchObject({
      estado: 'listo',
      procesadoSeg: 2,
      dudosas: ['praxias'],
      sinTexto: false,
    });
    // La vista nunca lleva el texto, y el audio quedó en cero.
    expect(JSON.stringify(cola.consultar(id, DATOS))).not.toContain('control');
    expect(muestras.every((m) => m === 0)).toBe(true);
  });

  it('otra persona u otro centro no ven el dictado', () => {
    const { motor } = motorControlado();
    const cola = new TrabajosDictado(motor, vi.fn());
    const { id } = cola.crear(DATOS, audio(1));
    expect(cola.consultar(id, { centroId: 'c1', usuarioId: 'u2' })).toBeNull();
    expect(cola.consultar(id, { centroId: 'c2', usuarioId: 'u1' })).toBeNull();
    expect(cola.descartar(id, { centroId: 'c2', usuarioId: 'u1' })).toBe(false);
    expect(cola.descartar(id, DATOS)).toBe(true);
    expect(cola.consultar(id, DATOS)).toBeNull();
  });

  it('si el motor falla, queda el error con su código y sin audio', async () => {
    const { motor, soltar } = motorControlado(
      new ErrorMotor('TR-02', 'respondió 500'),
    );
    const alTranscribir = vi.fn();
    const cola = new TrabajosDictado(motor, alTranscribir);
    const { id } = cola.crear(DATOS, audio(1));
    await soltar();
    expect(cola.consultar(id, DATOS)).toMatchObject({
      estado: 'error',
      codigo: 'TR-02',
    });
    expect(alTranscribir).not.toHaveBeenCalled();
  });

  it('si no se entendió nada, no toca el borrador', async () => {
    const { motor, soltar } = motorControlado({ texto: '', dudosas: [] });
    const alTranscribir = vi.fn();
    const cola = new TrabajosDictado(motor, alTranscribir);
    const { id } = cola.crear(DATOS, audio(1));
    await soltar();
    expect(cola.consultar(id, DATOS)).toMatchObject({
      estado: 'listo',
      sinTexto: true,
    });
    expect(alTranscribir).not.toHaveBeenCalled();
  });

  it('pone límites por persona, por minuto y a la cola total', () => {
    const { motor } = motorControlado();
    const cola = new TrabajosDictado(motor, vi.fn(), {
      maxPorPersona: 2,
      maxPorMinuto: 3,
      maxEnCola: 3,
    });
    cola.crear(DATOS, audio(1));
    cola.crear(DATOS, audio(1));
    expect(() => cola.crear(DATOS, audio(1))).toThrow(ErrorCola);
    const otra = { ...DATOS, usuarioId: 'u2' };
    cola.crear(otra, audio(1));
    cola.crear(otra, audio(1));
    expect(() => cola.crear({ ...DATOS, usuarioId: 'u3' }, audio(1))).toThrow(
      /muchos dictados/,
    );

    const porMinuto = new TrabajosDictado(motor, vi.fn(), {
      maxPorPersona: 10,
      maxPorMinuto: 2,
    });
    porMinuto.crear(DATOS, audio(1), 1_000);
    porMinuto.crear(DATOS, audio(1), 2_000);
    expect(() => porMinuto.crear(DATOS, audio(1), 3_000)).toThrow(
      /Esperá un minuto/,
    );
    expect(porMinuto.crear(DATOS, audio(1), 62_000).estado).toBe('en_cola');
  });
});

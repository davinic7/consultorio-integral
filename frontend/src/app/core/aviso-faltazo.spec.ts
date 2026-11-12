import { preguntarAvisoTarde } from './asistencia';

describe('pregunta del aviso al marcar ausente con aviso', () => {
  const ACTIVA = { activo: true, toleranciaHoras: 24 };

  it('solo pregunta con la regla activa y "ausente con aviso"', () => {
    const nunca = () => {
      throw new Error('no tenía que preguntar');
    };
    expect(preguntarAvisoTarde('ausente_sin_aviso', ACTIVA, nunca)).toBeUndefined();
    expect(
      preguntarAvisoTarde('ausente_con_aviso', { ...ACTIVA, activo: false }, nunca),
    ).toBeUndefined();
    expect(preguntarAvisoTarde('ausente_con_aviso', undefined, nunca)).toBeUndefined();
  });

  it('aceptar es aviso a tiempo; cancelar, aviso tarde', () => {
    let pregunta = '';
    expect(
      preguntarAvisoTarde('ausente_con_aviso', ACTIVA, (t) => {
        pregunta = t;
        return true;
      }),
    ).toBe(false);
    expect(pregunta).toContain('al menos 24 h');
    expect(preguntarAvisoTarde('ausente_con_aviso', ACTIVA, () => false)).toBe(true);
  });
});

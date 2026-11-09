import { colorDisciplina, iniciales } from './disciplina';

describe('colorDisciplina', () => {
  it('reconoce cada disciplina sin importar tildes ni mayúsculas', () => {
    expect(colorDisciplina('Psicopedagogía')).toBe('psicoped');
    expect(colorDisciplina('Fonoaudiología')).toBe('fono');
    expect(colorDisciplina('Terapia Ocupacional')).toBe('to');
    expect(colorDisciplina('T.O.')).toBe('to');
    expect(colorDisciplina('Psicología')).toBe('psi');
    expect(colorDisciplina(null)).toBe('psi');
  });

  it('arma iniciales', () => {
    expect(iniciales('Juana', 'Gómez')).toBe('JG');
    expect(iniciales('Ana María Paz')).toBe('AM');
  });
});

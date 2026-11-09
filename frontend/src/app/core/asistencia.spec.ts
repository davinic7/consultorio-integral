import { sePuedeMarcar } from './asistencia';

describe('sePuedeMarcar', () => {
  const ahora = Date.parse('2026-11-09T15:00:00Z');

  it('antes del turno solo admite ausente con aviso (o pendiente)', () => {
    const futuro = '2026-11-09T16:00:00Z';
    expect(sePuedeMarcar('presente', futuro, ahora)).toBe(false);
    expect(sePuedeMarcar('ausente_sin_aviso', futuro, ahora)).toBe(false);
    expect(sePuedeMarcar('ausente_con_aviso', futuro, ahora)).toBe(true);
    expect(sePuedeMarcar('pendiente', futuro, ahora)).toBe(true);
  });

  it('una vez empezado, admite todos', () => {
    const empezado = '2026-11-09T15:00:00Z';
    expect(sePuedeMarcar('presente', empezado, ahora)).toBe(true);
    expect(sePuedeMarcar('ausente_sin_aviso', empezado, ahora)).toBe(true);
  });
});

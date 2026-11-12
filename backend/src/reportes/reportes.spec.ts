import { mesesEntre, porcentajeAsistencia } from './reportes.js';

describe('reportes', () => {
  it('mesesEntre incluye los extremos y cruza el año', () => {
    expect(mesesEntre('2026-11', '2027-02')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(mesesEntre('2026-05', '2026-05')).toEqual(['2026-05']);
  });

  it('asistencia: presentes sobre los que tenían que venir', () => {
    expect(
      porcentajeAsistencia({
        presentes: 3,
        ausentesConAviso: 1,
        ausentesSinAviso: 0,
      }),
    ).toBe(75);
    expect(
      porcentajeAsistencia({
        presentes: 0,
        ausentesConAviso: 0,
        ausentesSinAviso: 0,
      }),
    ).toBeNull();
    expect(
      porcentajeAsistencia({
        presentes: 2,
        ausentesConAviso: 0,
        ausentesSinAviso: 1,
      }),
    ).toBe(67);
  });
});

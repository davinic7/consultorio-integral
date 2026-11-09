import {
  aInstante,
  aLocal,
  diasEntre,
  fechasSemanales,
  fechaTexto,
  formatoCorto,
  horaTexto,
  rangoDeFechas,
} from './tiempo.js';

const AR = 'America/Argentina/Catamarca'; // UTC−3, sin horario de verano

describe('tiempo', () => {
  it('convierte hora local del centro a instante y de vuelta', () => {
    const i = aInstante('2026-11-10', '10:00', AR);
    expect(i.toISOString()).toBe('2026-11-10T13:00:00.000Z');
    expect(aLocal(i, AR)).toEqual({ fecha: '2026-11-10', hora: '10:00' });
  });

  it('respeta cambios de horario en otras zonas', () => {
    // Madrid pasa de UTC+2 a UTC+1 el 25/10/2026.
    expect(
      aInstante('2026-10-24', '10:00', 'Europe/Madrid').toISOString(),
    ).toBe('2026-10-24T08:00:00.000Z');
    expect(
      aInstante('2026-10-26', '10:00', 'Europe/Madrid').toISOString(),
    ).toBe('2026-10-26T09:00:00.000Z');
  });

  it('arma el rango de días completos', () => {
    const r = rangoDeFechas('2026-11-09', '2026-11-15', AR);
    expect(r.desde.toISOString()).toBe('2026-11-09T03:00:00.000Z');
    expect(r.hasta.toISOString()).toBe('2026-11-16T03:00:00.000Z');
    expect(diasEntre('2026-11-09', '2026-11-15')).toBe(6);
  });

  it('genera las fechas de un día de la semana', () => {
    // 2026-11-09 es lunes; martes = 2.
    expect(fechasSemanales(2, '2026-11-09', '2026-11-30')).toEqual([
      '2026-11-10',
      '2026-11-17',
      '2026-11-24',
    ]);
    expect(fechasSemanales(1, '2026-11-09', '2026-11-09')).toEqual([
      '2026-11-09',
    ]);
  });

  it('valida fecha y hora', () => {
    expect(fechaTexto.safeParse('2026-02-30').success).toBe(false);
    expect(fechaTexto.safeParse('2026-02-28').success).toBe(true);
    expect(horaTexto.safeParse('24:00').success).toBe(false);
    expect(horaTexto.safeParse('09:30').success).toBe(true);
  });

  it('formatea para mensajes', () => {
    expect(formatoCorto(aInstante('2026-11-10', '10:00', AR), AR)).toBe(
      'mar 10/11 10:00',
    );
    expect(formatoCorto(aInstante('2026-11-15', '08:05', AR), AR)).toBe(
      'dom 15/11 08:05',
    );
  });
});

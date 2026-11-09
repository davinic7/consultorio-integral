import {
  diaSemana,
  diasDesde,
  etiquetaDia,
  fechaLarga,
  lunesDe,
  minutos,
  rangoLegible,
  sumarDias,
} from './fechas';

describe('fechas', () => {
  it('suma días cruzando meses y años', () => {
    expect(sumarDias('2026-11-30', 1)).toBe('2026-12-01');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('calcula el día de la semana y el lunes de la semana', () => {
    expect(diaSemana('2026-11-16')).toBe(1); // lunes
    expect(diaSemana('2026-11-22')).toBe(7); // domingo
    expect(lunesDe('2026-11-22')).toBe('2026-11-16');
    expect(lunesDe('2026-11-16')).toBe('2026-11-16');
    expect(diasDesde('2026-11-16', 7).at(-1)).toBe('2026-11-22');
  });

  it('arma textos para la agenda', () => {
    expect(etiquetaDia('2026-11-17')).toBe('mar 17');
    expect(fechaLarga('2026-11-17')).toBe('martes 17 de noviembre');
    expect(rangoLegible('2026-11-16', '2026-11-22')).toBe('16 al 22 de noviembre de 2026');
    expect(rangoLegible('2026-11-30', '2026-12-06')).toBe(
      '30 de noviembre al 6 de diciembre de 2026',
    );
    expect(minutos('10:45')).toBe(645);
  });
});

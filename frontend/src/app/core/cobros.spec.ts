import { nombreMes, plata, sumarMes } from './cobros';

describe('cobros', () => {
  it('formatea pesos', () => {
    expect(plata(12000).replace(/\s/g, ' ')).toBe('$ 12.000');
    expect(plata(1234.5).replace(/\s/g, ' ')).toBe('$ 1.234,5');
    expect(plata(null)).toBe('—');
  });

  it('nombra y recorre meses', () => {
    expect(nombreMes('2026-11')).toBe('Noviembre 2026');
    expect(sumarMes('2026-01', -1)).toBe('2025-12');
    expect(sumarMes('2026-12', 1)).toBe('2027-01');
    expect(sumarMes('2026-05', 0)).toBe('2026-05');
  });
});

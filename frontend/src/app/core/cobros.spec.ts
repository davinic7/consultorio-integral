import type { LiquidacionProfesional } from './api/modelos';
import { hojasDeLiquidacion, nombreMes, plata, sumarMes } from './cobros';

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

  describe('hojasDeLiquidacion', () => {
    const base: LiquidacionProfesional = {
      profesional: { id: 'p1', nombre: 'Laura', apellido: 'Díaz', disciplina: 'Psicología' },
      sesiones: 10,
      faltazos: 1,
      montoFaltazos: 6000,
      facturado: 126000,
      cobrado: 100000,
      alquiler: 37800,
      componentes: [{ tipo: 'porcentaje', valor: 30, base: 126000, monto: 37800 }],
      cobraElCentro: true,
      saldo: 88200,
      acuerdo: { id: 'a1', vigenteDesde: '2026-01', nota: null },
      liquidacion: {
        id: 'l1',
        estado: 'cerrada',
        cerradaEn: '2026-12-01T12:00:00Z',
        pagadaEn: null,
      },
      sinMarcar: 0,
      sinPrestacion: 0,
    };
    const otro: LiquidacionProfesional = {
      ...base,
      profesional: { id: 'p2', nombre: 'Juan', apellido: 'Paz', disciplina: 'Fonoaudiología' },
      sesiones: 4,
      faltazos: 0,
      montoFaltazos: 0,
      facturado: 48000,
      cobrado: 48000,
      alquiler: 20000.1,
      componentes: [],
      cobraElCentro: false,
      saldo: -20000.1,
      acuerdo: null,
      liquidacion: null,
    };

    it('un renglón por profesional, con lo que muestra la tarjeta', () => {
      const [hoja] = hojasDeLiquidacion('2026-11', [base, otro], false);
      expect(hoja!.nombre).toBe('Liquidación Noviembre 2026');
      expect(hoja!.columnas).toHaveLength(13);
      const [a, b] = hoja!.filas;
      expect(a!.slice(0, 8)).toEqual([
        'Díaz, Laura',
        'Psicología',
        10,
        1,
        6000,
        126000,
        100000,
        37800,
      ]);
      expect(String(a![8]).replace(/\s/g, ' ')).toBe('30 % de lo facturado ($ 126.000): $ 37.800');
      expect(a!.slice(9)).toEqual(['El centro', 88200, 'El centro le paga', 'Generada']);
      expect(b!.slice(8)).toEqual([
        'Sin acuerdo',
        'El profesional',
        -20000.1,
        'Le debe al centro',
        'Sin generar',
      ]);
      // Total sin errores de redondeo.
      expect(hoja!.total).toEqual([
        'Total',
        null,
        14,
        1,
        6000,
        174000,
        148000,
        57800.1,
        null,
        null,
        68199.9,
      ]);
    });

    it('para un profesional habla en segunda persona y no lleva total', () => {
      const [hoja] = hojasDeLiquidacion('2026-11', [{ ...base, componentes: [] }], true);
      expect(hoja!.filas[0]![8]).toBe('Sin cargo');
      expect(hoja!.filas[0]![11]).toBe('Te paga el centro');
      expect(hoja!.total).toBeUndefined();
    });
  });
});

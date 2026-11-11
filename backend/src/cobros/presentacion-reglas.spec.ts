import {
  emparejarTokens,
  leerTokens,
  semanaDe,
  sugerirFechas,
} from './presentacion-reglas.js';

describe('presentación a obras sociales', () => {
  it('semana ISO', () => {
    expect(semanaDe('2026-11-09')).toBe('2026-W46'); // lunes
    expect(semanaDe('2026-11-15')).toBe('2026-W46'); // domingo
    expect(semanaDe('2027-01-01')).toBe('2026-W53');
  });

  it('respeta las fechas reales cuando cumplen las reglas', () => {
    const r = sugerirFechas({
      mes: '2026-11',
      reales: ['2026-11-03', '2026-11-05'],
      emision: '2026-11-01',
      maxSemana: 3,
    });
    expect(r.map((x) => x.sugerida)).toEqual(['2026-11-03', '2026-11-05']);
    expect(r.every((x) => x.aviso === null)).toBe(true);
  });

  it('corre las sesiones anteriores a la orden y llena semanas', () => {
    // Orden emitida el jueves 5; tres sesiones antes y máximo 2 por semana.
    const r = sugerirFechas({
      mes: '2026-11',
      reales: ['2026-11-02', '2026-11-03', '2026-11-04'],
      emision: '2026-11-05',
      maxSemana: 2,
    });
    expect(r.map((x) => x.sugerida)).toEqual([
      '2026-11-05',
      '2026-11-06',
      '2026-11-09',
    ]);
    expect(r[0]!.aviso).toBe('Movida: orden emitida el 05/11');
    expect(r[2]!.aviso).toBe('Movida: orden emitida el 05/11');
  });

  it('no usa días ocupados, domingos ni fechas después del vencimiento', () => {
    const r = sugerirFechas({
      mes: '2026-11',
      reales: ['2026-11-27', '2026-11-28'],
      ocupadas: ['2026-11-27'],
      vence: '2026-11-28',
    });
    // El 27 está ocupado → 28 (sábado); la segunda no entra (29 es domingo y vence el 28).
    expect(r.map((x) => x.sugerida)).toEqual(['2026-11-28', null]);
    expect(r[1]!.aviso).toBe('No entra: la orden vence el 28/11');
  });

  it('empareja tokens por afiliado o DNI, sin repetir', () => {
    const pacientes = [
      { id: 'a', dni: '30.111.222', nroAfiliado: '12-3456/7' },
      { id: 'b', dni: '28111222', nroAfiliado: null },
    ];
    const libres = new Map([
      [
        'a',
        [
          { id: 's1', fecha: '2026-11-03' },
          { id: 's2', fecha: '2026-11-05' },
        ],
      ],
      ['b', [{ id: 's3', fecha: '2026-11-04' }]],
    ]);
    const usados = new Map([['a', new Set(['YA111'])]]);
    const r = emparejarTokens(
      [
        { token: 'ab-12cd', afiliado: '1234567' },
        { token: 'AB12CD', afiliado: '1234567' },
        { token: 'YA111', afiliado: '1234567' },
        { token: 'XY9999', dni: '28111222' },
        { token: 'ZZ0000', dni: '28111222' },
        { token: 'QQ1111', dni: '99' },
        { token: '!!' },
      ],
      pacientes,
      libres,
      usados,
    );
    expect(r.map((x) => x.estado)).toEqual([
      'ok',
      'duplicado',
      'duplicado',
      'ok',
      'sin_sesion',
      'sin_paciente',
      'invalido',
    ]);
    expect(r[0]).toMatchObject({
      token: 'AB12CD',
      pacienteId: 'a',
      por: 'afiliado',
      prestacionId: 's1',
    });
    expect(r[3]).toMatchObject({
      pacienteId: 'b',
      por: 'dni',
      prestacionId: 's3',
    });
  });

  it('lee tokens pegados como texto', () => {
    expect(leerTokens('AB12CD 30111222\n\nXY9999, 12-3456/7\nZZ00')).toEqual([
      { token: 'AB12CD', dni: '30111222' },
      { token: 'XY9999', afiliado: '12-3456/7' },
      { token: 'ZZ00', afiliado: null },
    ]);
  });
});

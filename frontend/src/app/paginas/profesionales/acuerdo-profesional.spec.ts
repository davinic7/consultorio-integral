import type { AcuerdoAlquiler } from '../../core/api/modelos';
import { textoComponente } from '../../core/cobros';
import { resumenAcuerdo } from './acuerdo-profesional';

const BASE: AcuerdoAlquiler = {
  id: 'a',
  vigenteDesde: '2026-10',
  montoFijo: null,
  porcentaje: null,
  montoPorSesion: null,
  montoPorHora: null,
  sesionesEquivalentes: null,
  cobraElCentro: true,
  nota: null,
  creadoEn: '2026-10-01T00:00:00Z',
};

describe('acuerdos de alquiler en pantalla', () => {
  it('resume un acuerdo mixto en una línea', () => {
    const r = resumenAcuerdo({ ...BASE, montoFijo: 20000, porcentaje: 10 });
    expect(r).toMatch(/^cuota fija \$\s?20\.000 \+ 10 % de lo facturado$/);
  });

  it('avisa cuando cobra el profesional y cuando no hay cargo', () => {
    expect(resumenAcuerdo({ ...BASE, cobraElCentro: false, sesionesEquivalentes: 1 })).toBe(
      '1 sesión al precio particular · cobra el profesional',
    );
    expect(resumenAcuerdo(BASE)).toBe('sin cargo');
  });

  it('explica cada renglón del cálculo', () => {
    expect(textoComponente({ tipo: 'por_hora', valor: 2000, base: 7.5, monto: 15000 })).toMatch(
      /^7,5 h de sala × \$\s?2\.000$/,
    );
    expect(textoComponente({ tipo: 'por_sesion', valor: 500, base: 1, monto: 500 })).toMatch(
      /^1 sesión × \$\s?500$/,
    );
    expect(
      textoComponente({ tipo: 'sesiones_equivalentes', valor: 4, base: 12000, monto: 48000 }),
    ).toMatch(/^Equivalente a 4 sesiones \(\$\s?12\.000 c\/u\)$/);
  });
});

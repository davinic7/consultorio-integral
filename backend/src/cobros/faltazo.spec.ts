import {
  EstadoAsistencia,
  ModoFaltazo,
  Prisma,
} from '../generated/prisma/client.js';
import {
  avisoTardeAlMarcar,
  avisoTardeDe,
  esFaltazo,
  montoFaltazo,
  type ReglaFaltazo,
} from './faltazo.js';

const D = (n: number) => new Prisma.Decimal(n);
const REGLA: ReglaFaltazo = {
  activo: true,
  toleranciaHoras: 24,
  modo: ModoFaltazo.completa,
  monto: null,
};
const TURNO = new Date('2026-11-20T15:00:00Z');
const horasAntes = (h: number) => new Date(TURNO.getTime() - h * 3_600_000);

describe('regla de faltazo', () => {
  it('aviso con menos de 24 h es tarde; con 24 h o más, a tiempo', () => {
    expect(avisoTardeDe(TURNO, horasAntes(23.5), 24)).toBe(true);
    expect(avisoTardeDe(TURNO, horasAntes(24), 24)).toBe(false);
    expect(avisoTardeDe(TURNO, horasAntes(48), 24)).toBe(false);
    expect(avisoTardeDe(TURNO, horasAntes(3), 2)).toBe(false);
  });

  it('al marcar: manda lo indicado; si no, el momento de marcar (antes del turno)', () => {
    expect(avisoTardeAlMarcar(TURNO, horasAntes(48), 24, true)).toBe(true);
    expect(avisoTardeAlMarcar(TURNO, horasAntes(5), 24, undefined)).toBe(true);
    expect(avisoTardeAlMarcar(TURNO, horasAntes(30), 24, undefined)).toBe(
      false,
    );
    // Marcado después del turno sin decir cuándo avisó: no se cobra.
    expect(avisoTardeAlMarcar(TURNO, horasAntes(-2), 24, undefined)).toBe(
      false,
    );
  });

  it('es faltazo: sin aviso siempre; con aviso solo si llegó tarde; apagada nunca', () => {
    const { ausente_sin_aviso, ausente_con_aviso, presente } = EstadoAsistencia;
    expect(esFaltazo(REGLA, ausente_sin_aviso, null)).toBe(true);
    expect(esFaltazo(REGLA, ausente_con_aviso, true)).toBe(true);
    expect(esFaltazo(REGLA, ausente_con_aviso, false)).toBe(false);
    expect(esFaltazo(REGLA, presente, null)).toBe(false);
    expect(
      esFaltazo({ ...REGLA, activo: false }, ausente_sin_aviso, null),
    ).toBe(false);
  });

  it('cobra la sesión completa, la mitad o un monto fijo', () => {
    expect(montoFaltazo(REGLA, D(12_000)).toNumber()).toBe(12_000);
    expect(
      montoFaltazo({ ...REGLA, modo: ModoFaltazo.mitad }, D(12_001)).toNumber(),
    ).toBe(6_000.5);
    expect(
      montoFaltazo(
        { ...REGLA, modo: ModoFaltazo.fijo, monto: D(5_000) },
        D(12_000),
      ).toNumber(),
    ).toBe(5_000);
  });
});

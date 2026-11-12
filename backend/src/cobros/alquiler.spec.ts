import { Prisma } from '../generated/prisma/client.js';
import { calcularAlquiler, horasDe, type Acuerdo } from './alquiler.js';

const D = (n: number) => new Prisma.Decimal(n);
const NADA: Acuerdo = {
  montoFijo: null,
  porcentaje: null,
  montoPorSesion: null,
  montoPorHora: null,
  sesionesEquivalentes: null,
  cobraElCentro: true,
};
const MES = {
  facturado: D(100_000),
  sesiones: 10,
  horasSala: D(7.5),
  precioSesion: D(12_000),
};
const alquiler = (a: Partial<Acuerdo>, actividad = MES) =>
  calcularAlquiler({ ...NADA, ...a }, actividad);

describe('acuerdos de alquiler', () => {
  it('porcentaje de lo facturado (como el porcentaje de antes)', () => {
    const r = alquiler({ porcentaje: D(30) });
    expect(r.alquiler.toNumber()).toBe(30_000);
    expect(r.saldo.toNumber()).toBe(70_000);
    expect(r.componentes).toEqual([
      { tipo: 'porcentaje', valor: 30, base: 100_000, monto: 30_000 },
    ]);
  });

  it('cuota fija mensual, aunque no haya sesiones', () => {
    const r = alquiler(
      { montoFijo: D(80_000) },
      { ...MES, facturado: D(0), sesiones: 0 },
    );
    expect(r.alquiler.toNumber()).toBe(80_000);
    expect(r.saldo.toNumber()).toBe(-80_000);
  });

  it('equivalente a N sesiones al precio particular vigente', () => {
    const r = alquiler({ sesionesEquivalentes: 4 });
    expect(r.alquiler.toNumber()).toBe(48_000);
    expect(r.componentes[0]).toMatchObject({ base: 12_000, valor: 4 });
  });

  it('monto por sesión atendida', () => {
    expect(alquiler({ montoPorSesion: D(2_500) }).alquiler.toNumber()).toBe(
      25_000,
    );
  });

  it('monto por hora de sala', () => {
    const r = alquiler({ montoPorHora: D(3_000) });
    expect(r.alquiler.toNumber()).toBe(22_500);
    expect(r.componentes[0].base).toBe(7.5);
  });

  it('mixto: fijo más porcentaje (y cualquier combinación)', () => {
    const r = alquiler({ montoFijo: D(20_000), porcentaje: D(10) });
    expect(r.alquiler.toNumber()).toBe(30_000);
    expect(r.componentes.map((c) => c.tipo)).toEqual(['fijo', 'porcentaje']);
    const todo = alquiler({
      montoFijo: D(1),
      porcentaje: D(1),
      montoPorSesion: D(1),
      montoPorHora: D(1),
      sesionesEquivalentes: 1,
    });
    expect(todo.alquiler.toNumber()).toBe(1 + 1_000 + 10 + 7.5 + 12_000);
  });

  it('si cobra el profesional, el saldo es lo que le debe al centro', () => {
    const r = alquiler({ porcentaje: D(30), cobraElCentro: false });
    expect(r.saldo.toNumber()).toBe(-30_000);
  });

  it('sin acuerdo no hay alquiler y el centro liquida todo lo facturado', () => {
    const r = calcularAlquiler(null, MES);
    expect(r.alquiler.toNumber()).toBe(0);
    expect(r.componentes).toEqual([]);
    expect(r.saldo.toNumber()).toBe(100_000);
  });

  it('redondea cada componente al centavo', () => {
    const r = alquiler(
      { porcentaje: D(33.33) },
      { ...MES, facturado: D(100.01) },
    );
    expect(r.alquiler.toNumber()).toBe(33.33);
  });

  it('horas de un turno', () => {
    const inicio = new Date('2026-11-02T13:00:00Z');
    expect(horasDe(inicio, new Date('2026-11-02T13:45:00Z')).toNumber()).toBe(
      0.75,
    );
  });
});

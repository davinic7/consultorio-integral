import { EstadoPago, Prisma } from '../generated/prisma/client.js';
import {
  avisosDe,
  cobroDe,
  liquidar,
  vencimientoDeOrden,
  type DatosAvisos,
} from './reglas.js';

const D = (n: number) => new Prisma.Decimal(n);
const pago = (monto: number, estado: EstadoPago) => ({
  monto: D(monto),
  estado,
});

describe('reglas de cobro', () => {
  it('estado del cobro según los pagos', () => {
    expect(cobroDe(D(100), []).estado).toBe('pendiente');
    expect(cobroDe(D(100), [pago(40, EstadoPago.cobrado)])).toMatchObject({
      estado: 'parcial',
    });
    expect(
      cobroDe(D(100), [pago(40, EstadoPago.cobrado)]).saldo.toNumber(),
    ).toBe(60);
    expect(
      cobroDe(D(100), [
        pago(40, EstadoPago.cobrado),
        pago(60, EstadoPago.cobrado),
      ]).estado,
    ).toBe('cobrada');
    expect(cobroDe(D(100), [pago(100, EstadoPago.rechazado)]).estado).toBe(
      'rechazada',
    );
    // Rechazado pero con otro pago en curso: sigue pendiente.
    expect(
      cobroDe(D(100), [
        pago(100, EstadoPago.rechazado),
        pago(100, EstadoPago.pendiente),
      ]).estado,
    ).toBe('pendiente');
    // Un pago pendiente no cuenta como cobrado.
    expect(
      cobroDe(D(100), [pago(100, EstadoPago.pendiente)]).cobrado.toNumber(),
    ).toBe(0);
  });

  it('suma sin errores de punto flotante', () => {
    const r = cobroDe(D(0.3), [
      pago(0.1, EstadoPago.cobrado),
      pago(0.2, EstadoPago.cobrado),
    ]);
    expect(r.estado).toBe('cobrada');
    expect(r.saldo.toNumber()).toBe(0);
  });

  it('avisos de lo que falta', () => {
    const base: DatosAvisos = {
      fecha: '2026-10-05',
      monto: D(8000),
      facturada: false,
      token: null,
      financiador: { requiereOrden: true, requiereToken: true },
      orden: null,
      estadoCobro: 'pendiente',
    };
    expect(avisosDe(base)).toEqual([
      'falta_orden',
      'falta_token',
      'sin_facturar',
    ]);
    expect(
      avisosDe({
        ...base,
        token: 'AB12',
        facturada: true,
        orden: { fechaEmision: '2026-09-01', vence: '2026-09-30' },
      }),
    ).toEqual(['orden_vencida', 'facturada_sin_cobrar']);
    expect(
      avisosDe({
        ...base,
        token: 'AB12',
        orden: { fechaEmision: '2026-10-01', vence: null },
        estadoCobro: 'cobrada',
      }),
    ).toEqual([]);
    // Particular sin cobrar y sin precio.
    expect(avisosDe({ ...base, financiador: null })).toEqual(['impaga']);
    expect(avisosDe({ ...base, financiador: null, monto: D(0) })).toEqual([
      'sin_precio',
    ]);
    expect(
      avisosDe({ ...base, financiador: null, estadoCobro: 'rechazada' }),
    ).toEqual(['rechazada']);
  });

  it('liquida por porcentaje redondeando al centavo', () => {
    const r = liquidar(D(1000.05), D(70));
    expect(r.liquidado.toNumber()).toBe(700.04); // 700,035 → 700,04
    expect(r.retencion.toNumber()).toBe(300.01);
    expect(liquidar(D(0), D(70)).liquidado.toNumber()).toBe(0);
  });

  it('vencimiento de una orden', () => {
    expect(vencimientoDeOrden('2026-10-01', 30)).toBe('2026-10-30');
    expect(vencimientoDeOrden('2026-10-01', null)).toBeNull();
  });
});

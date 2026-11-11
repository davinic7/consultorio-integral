import { EstadoPago, Prisma } from '../generated/prisma/client.js';

/**
 * Reglas de cobro y liquidación sin base de datos (se testean aparte).
 * Los montos se suman con Decimal para no arrastrar errores de punto flotante.
 */

export type Decimal = Prisma.Decimal;
export const CERO = new Prisma.Decimal(0);

export const sumar = (montos: Iterable<Decimal>): Decimal => {
  let total = CERO;
  for (const m of montos) total = total.plus(m);
  return total;
};

/**
 * Cómo está el cobro de una prestación:
 * - cobrada: lo cobrado cubre el monto.
 * - parcial: hay algo cobrado pero no alcanza.
 * - rechazada: la obra social (o el banco) rechazó el pago y no hay otro en curso.
 * - pendiente: no hay nada cobrado.
 */
export type EstadoCobro = 'pendiente' | 'parcial' | 'cobrada' | 'rechazada';

export interface PagoMinimo {
  monto: Decimal;
  estado: EstadoPago;
}

export function cobroDe(monto: Decimal, pagos: readonly PagoMinimo[]) {
  const cobrado = sumar(
    pagos.filter((p) => p.estado === EstadoPago.cobrado).map((p) => p.monto),
  );
  const enCurso = pagos.some((p) => p.estado === EstadoPago.pendiente);
  const rechazado = pagos.some((p) => p.estado === EstadoPago.rechazado);
  const saldo = Prisma.Decimal.max(monto.minus(cobrado), CERO);
  let estado: EstadoCobro;
  if (monto.gt(0) && cobrado.gte(monto)) estado = 'cobrada';
  else if (cobrado.gt(0)) estado = 'parcial';
  else if (rechazado && !enCurso) estado = 'rechazada';
  else estado = 'pendiente';
  return { cobrado, saldo, estado };
}

/** Lo que falta o no cierra en una prestación, para la conciliación. */
export type AvisoPrestacion =
  | 'sin_precio'
  | 'falta_orden'
  | 'orden_vencida'
  | 'falta_token'
  | 'sin_facturar'
  | 'facturada_sin_cobrar'
  | 'rechazada'
  | 'impaga';

export interface DatosAvisos {
  fecha: string;
  monto: Decimal;
  facturada: boolean;
  token: string | null;
  financiador: { requiereOrden: boolean; requiereToken: boolean } | null;
  orden: { fechaEmision: string; vence: string | null } | null;
  estadoCobro: EstadoCobro;
}

export function avisosDe(p: DatosAvisos): AvisoPrestacion[] {
  const avisos: AvisoPrestacion[] = [];
  if (p.monto.isZero()) avisos.push('sin_precio');
  const f = p.financiador;
  if (f?.requiereOrden) {
    if (!p.orden) avisos.push('falta_orden');
    else if (
      p.fecha < p.orden.fechaEmision ||
      (p.orden.vence !== null && p.fecha > p.orden.vence)
    )
      avisos.push('orden_vencida');
  }
  if (f?.requiereToken && !p.token) avisos.push('falta_token');
  if (p.estadoCobro === 'rechazada') avisos.push('rechazada');
  else if (p.estadoCobro !== 'cobrada') {
    // Con obra social: primero se presenta (factura) y después se cobra.
    // Particular: la sesión se cobra al paciente.
    if (f && !p.facturada) avisos.push('sin_facturar');
    else if (f) avisos.push('facturada_sin_cobrar');
    else if (!p.monto.isZero()) avisos.push('impaga');
  }
  return avisos;
}

/** Lo que le corresponde al profesional: bruto × porcentaje, redondeado al centavo. */
export function liquidar(bruto: Decimal, porcentaje: Decimal) {
  const liquidado = bruto
    .mul(porcentaje)
    .div(100)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { liquidado, retencion: bruto.minus(liquidado) };
}

/** Vencimiento de una orden: emisión + días de validez − 1 (el día de emisión cuenta). */
export function vencimientoDeOrden(
  fechaEmision: string,
  diasValidez: number | null,
): string | null {
  if (!diasValidez) return null;
  return Temporal.PlainDate.from(fechaEmision)
    .add({ days: diasValidez - 1 })
    .toString();
}

/** Decimal → número para la API (montos de hasta 12 dígitos: sin pérdida). */
export const num = (d: Decimal): number => d.toNumber();

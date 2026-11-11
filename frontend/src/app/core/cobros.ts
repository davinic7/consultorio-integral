import type { AvisoPrestacion, EstadoCobro, EstadoLiquidacion, MedioPago } from './api/modelos';

export const NOMBRE_MEDIO: Record<MedioPago, string> = {
  efectivo: 'Efectivo',
  transferencia: 'Transferencia',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};
export const MEDIOS = Object.keys(NOMBRE_MEDIO) as MedioPago[];

export const NOMBRE_COBRO: Record<EstadoCobro, string> = {
  pendiente: 'Por cobrar',
  parcial: 'Pago parcial',
  cobrada: 'Cobrada',
  rechazada: 'Rechazada',
};

/** Clase de .oc-estado para cada estado de cobro. */
export const CLASE_COBRO: Record<EstadoCobro, string> = {
  pendiente: 'oc-estado oc-estado--aviso',
  parcial: 'oc-estado oc-estado--info',
  cobrada: 'oc-estado oc-estado--ok',
  rechazada: 'oc-estado oc-estado--error',
};

export const NOMBRE_AVISO: Record<AvisoPrestacion | 'sin_prestacion', string> = {
  sin_prestacion: 'Presente sin registrar para cobrar',
  sin_precio: 'Sin precio',
  falta_orden: 'Falta la orden',
  orden_vencida: 'Orden fuera de fecha',
  falta_token: 'Falta el token',
  sin_facturar: 'Sin presentar a la obra social',
  facturada_sin_cobrar: 'Presentada, sin cobrar',
  rechazada: 'Pago rechazado',
  impaga: 'Impaga',
};

export const NOMBRE_LIQUIDACION: Record<EstadoLiquidacion, string> = {
  borrador: 'Reabierta',
  cerrada: 'Generada',
  pagada: 'Pagada',
};

const PESOS = new Intl.NumberFormat('es-AR', {
  style: 'currency',
  currency: 'ARS',
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

/** 12000 → "$ 12.000". */
export function plata(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : PESOS.format(n);
}

const MESES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/** "2026-11" → "Noviembre 2026". */
export function nombreMes(mes: string): string {
  const [a, m] = mes.split('-');
  return `${MESES[Number(m) - 1]} ${a}`;
}

/** Mes anterior o siguiente: sumarMes("2026-01", -1) → "2025-12". */
export function sumarMes(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const total = a! * 12 + (m! - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

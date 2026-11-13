import type {
  AvisoPrestacion,
  EstadoCobro,
  EstadoLiquidacion,
  MedioPago,
  ComponenteAlquiler,
  LiquidacionProfesional,
} from './api/modelos';
import type { Hoja } from './excel';

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
/** Renglón del cálculo del alquiler, en palabras. */
export function textoComponente(c: ComponenteAlquiler): string {
  const base = c.base ?? 0;
  switch (c.tipo) {
    case 'fijo':
      return 'Cuota fija mensual';
    case 'porcentaje':
      return `${c.valor} % de lo facturado (${plata(base)})`;
    case 'por_sesion':
      return `${base} ${base === 1 ? 'sesión' : 'sesiones'} × ${plata(c.valor)}`;
    case 'por_hora':
      return `${base.toLocaleString('es-AR')} h de sala × ${plata(c.valor)}`;
    case 'sesiones_equivalentes':
      return `Equivalente a ${c.valor} ${c.valor === 1 ? 'sesión' : 'sesiones'} (${plata(base)} c/u)`;
  }
}

/** Qué significa el saldo, desde el centro o desde el profesional. */
export function textoSaldo(saldo: number, paraProfesional: boolean): string {
  if (saldo === 0) return 'Sin saldo';
  if (saldo > 0) return paraProfesional ? 'Te paga el centro' : 'El centro le paga';
  return paraProfesional ? 'Le debés al centro' : 'Le debe al centro';
}

/**
 * La hoja del Excel de liquidación de un mes: un renglón por profesional, con lo
 * mismo que muestran las tarjetas. El saldo va con signo (negativo: le debe al centro).
 */
export function hojasDeLiquidacion(
  mes: string,
  liquidaciones: LiquidacionProfesional[],
  paraProfesional: boolean,
): Hoja[] {
  const suma = (campo: (l: LiquidacionProfesional) => number) =>
    Math.round(liquidaciones.reduce((n, l) => n + campo(l), 0) * 100) / 100;
  return [
    {
      nombre: `Liquidación ${nombreMes(mes)}`,
      columnas: [
        { titulo: 'Profesional' },
        { titulo: 'Disciplina', ancho: 22 },
        { titulo: 'Sesiones', formato: 'entero' },
        { titulo: 'Faltazos cobrables', formato: 'entero' },
        { titulo: 'Monto de faltazos', formato: 'plata' },
        { titulo: 'Facturado', formato: 'plata' },
        { titulo: 'Cobrado', formato: 'plata' },
        { titulo: 'Alquiler', formato: 'plata' },
        { titulo: 'Detalle del alquiler', ancho: 48 },
        { titulo: 'Quién cobra', ancho: 16 },
        { titulo: 'Saldo', formato: 'plata' },
        { titulo: 'Qué significa el saldo', ancho: 24 },
        { titulo: 'Estado', ancho: 14 },
      ],
      filas: liquidaciones.map((l) => [
        `${l.profesional.apellido}, ${l.profesional.nombre}`,
        l.profesional.disciplina,
        l.sesiones,
        l.faltazos,
        l.montoFaltazos,
        l.facturado,
        l.cobrado,
        l.alquiler,
        l.componentes.length
          ? l.componentes.map((c) => `${textoComponente(c)}: ${plata(c.monto)}`).join(' + ')
          : l.acuerdo
            ? 'Sin cargo'
            : 'Sin acuerdo',
        l.cobraElCentro ? 'El centro' : 'El profesional',
        l.saldo,
        textoSaldo(l.saldo, paraProfesional),
        l.liquidacion ? NOMBRE_LIQUIDACION[l.liquidacion.estado] : 'Sin generar',
      ]),
      // El total solo tiene sentido con más de un profesional.
      total:
        liquidaciones.length > 1
          ? [
              'Total',
              null,
              suma((l) => l.sesiones),
              suma((l) => l.faltazos),
              suma((l) => l.montoFaltazos),
              suma((l) => l.facturado),
              suma((l) => l.cobrado),
              suma((l) => l.alquiler),
              null,
              null,
              suma((l) => l.saldo),
            ]
          : undefined,
    },
  ];
}

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

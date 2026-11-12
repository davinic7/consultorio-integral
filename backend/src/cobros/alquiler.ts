import { Prisma } from '../generated/prisma/client.js';
import { CERO, sumar, type Decimal } from './reglas.js';

/** Componentes que puede sumar un acuerdo de alquiler. */
export type TipoComponente =
  'fijo' | 'porcentaje' | 'por_sesion' | 'por_hora' | 'sesiones_equivalentes';

/** Lo que define un acuerdo (todos opcionales: se suman los cargados). */
export interface Acuerdo {
  montoFijo: Decimal | null;
  porcentaje: Decimal | null;
  montoPorSesion: Decimal | null;
  montoPorHora: Decimal | null;
  sesionesEquivalentes: number | null;
  cobraElCentro: boolean;
}

/** Lo que hizo el profesional en el mes. */
export interface ActividadDelMes {
  /** Lo facturado por sus sesiones. */
  facturado: Decimal;
  /** Sesiones atendidas. */
  sesiones: number;
  /** Horas de turnos atendidos en una sala. */
  horasSala: Decimal;
  /** Precio particular vigente de la sesión (para "N sesiones"). */
  precioSesion: Decimal;
}

export interface ComponenteCalculado {
  tipo: TipoComponente;
  /** El valor del acuerdo: monto, porcentaje, monto por unidad o N. */
  valor: number;
  /** Sobre qué se aplicó: facturado, sesiones, horas o precio de la sesión. */
  base: number | null;
  monto: number;
}

export interface CalculoAlquiler {
  alquiler: Decimal;
  componentes: ComponenteCalculado[];
  /**
   * Saldo del mes. Si el centro cobra por el profesional: lo facturado menos el
   * alquiler (positivo, el centro le paga). Si cobra el profesional: menos el
   * alquiler (lo que le debe al centro).
   */
  saldo: Decimal;
}

const centavos = (d: Decimal) =>
  d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

/** Cuánto le debe el profesional al centro en el mes según su acuerdo. */
export function calcularAlquiler(
  acuerdo: Acuerdo | null,
  actividad: ActividadDelMes,
): CalculoAlquiler {
  const componentes: ComponenteCalculado[] = [];
  const sumarComponente = (
    tipo: TipoComponente,
    valor: Decimal,
    base: Decimal | number | null,
    monto: Decimal,
  ) =>
    componentes.push({
      tipo,
      valor: valor.toNumber(),
      base: base === null ? null : Number(base.valueOf()),
      monto: centavos(monto).toNumber(),
    });

  if (acuerdo) {
    const a = acuerdo;
    if (a.montoFijo) sumarComponente('fijo', a.montoFijo, null, a.montoFijo);
    if (a.porcentaje)
      sumarComponente(
        'porcentaje',
        a.porcentaje,
        actividad.facturado,
        actividad.facturado.mul(a.porcentaje).div(100),
      );
    if (a.montoPorSesion)
      sumarComponente(
        'por_sesion',
        a.montoPorSesion,
        actividad.sesiones,
        a.montoPorSesion.mul(actividad.sesiones),
      );
    if (a.montoPorHora)
      sumarComponente(
        'por_hora',
        a.montoPorHora,
        actividad.horasSala,
        a.montoPorHora.mul(actividad.horasSala),
      );
    if (a.sesionesEquivalentes)
      sumarComponente(
        'sesiones_equivalentes',
        new Prisma.Decimal(a.sesionesEquivalentes),
        actividad.precioSesion,
        actividad.precioSesion.mul(a.sesionesEquivalentes),
      );
  }
  const alquiler = sumar(componentes.map((c) => new Prisma.Decimal(c.monto)));
  const cobraElCentro = acuerdo?.cobraElCentro ?? true;
  return {
    alquiler,
    componentes,
    saldo: (cobraElCentro ? actividad.facturado : CERO).minus(alquiler),
  };
}

/** Horas (con dos decimales) de un turno entre inicio y fin. */
export function horasDe(inicio: Date, fin: Date): Decimal {
  return new Prisma.Decimal(fin.getTime() - inicio.getTime())
    .div(3_600_000)
    .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

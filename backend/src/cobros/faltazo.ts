import {
  EstadoAsistencia,
  ModoFaltazo,
  Prisma,
} from '../generated/prisma/client.js';
import type { Decimal } from './reglas.js';

/** Regla de faltazo de un profesional. */
export interface ReglaFaltazo {
  activo: boolean;
  toleranciaHoras: number;
  modo: ModoFaltazo;
  /** Monto con modo "fijo". */
  monto: Decimal | null;
}

/**
 * ¿El aviso llegó tarde? Avisar con menos horas de anticipación que la
 * tolerancia (o después de la hora del turno) cuenta como faltazo.
 */
export function avisoTardeDe(
  inicio: Date,
  aviso: Date,
  toleranciaHoras: number,
): boolean {
  return inicio.getTime() - aviso.getTime() < toleranciaHoras * 3_600_000;
}

/**
 * Si el paciente avisó, cuándo: lo que diga quien marca y, si no lo dice y
 * marca antes del turno, el momento de marcar. Si marca después del turno sin
 * decirlo, se toma como aviso a tiempo (no se cobra lo que no se sabe).
 */
export function avisoTardeAlMarcar(
  inicio: Date,
  ahora: Date,
  toleranciaHoras: number,
  indicado: boolean | undefined,
): boolean {
  if (indicado !== undefined) return indicado;
  if (ahora.getTime() >= inicio.getTime()) return false;
  return avisoTardeDe(inicio, ahora, toleranciaHoras);
}

/** ¿Ese estado de asistencia es un faltazo según la regla? */
export function esFaltazo(
  regla: ReglaFaltazo,
  estado: EstadoAsistencia,
  avisoTarde: boolean | null,
): boolean {
  if (!regla.activo) return false;
  if (estado === EstadoAsistencia.ausente_sin_aviso) return true;
  return estado === EstadoAsistencia.ausente_con_aviso && avisoTarde === true;
}

/** Cuánto se cobra: la sesión completa, la mitad (al centavo) o un monto fijo. */
export function montoFaltazo(regla: ReglaFaltazo, precio: Decimal): Decimal {
  switch (regla.modo) {
    case ModoFaltazo.completa:
      return precio;
    case ModoFaltazo.mitad:
      return precio.div(2).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    case ModoFaltazo.fijo:
      return regla.monto ?? new Prisma.Decimal(0);
  }
}

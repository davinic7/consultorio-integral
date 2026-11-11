import { z } from 'zod';

/**
 * Fechas y horas de la agenda. La base guarda instantes (UTC); la API habla en la
 * hora local del centro (centros.zona_horaria) con fecha "AAAA-MM-DD" y hora "HH:MM".
 * Las conversiones usan Temporal (incluido en Node 26), que maneja bien los
 * cambios de horario.
 */

export const fechaTexto = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'formato AAAA-MM-DD')
  .refine((s) => {
    try {
      Temporal.PlainDate.from(s, { overflow: 'reject' });
      return true;
    } catch {
      return false;
    }
  }, 'fecha inválida');

export const horaTexto = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'formato HH:MM (24 h)');

/** Fecha y hora locales del centro → instante. */
export function aInstante(fecha: string, hora: string, zona: string): Date {
  const zdt = Temporal.PlainDate.from(fecha).toZonedDateTime({
    timeZone: zona,
    plainTime: Temporal.PlainTime.from(hora),
  });
  return new Date(zdt.epochMilliseconds);
}

/** Instante → fecha y hora locales del centro. */
export function aLocal(
  instante: Date,
  zona: string,
): { fecha: string; hora: string } {
  const zdt = Temporal.Instant.fromEpochMilliseconds(
    instante.getTime(),
  ).toZonedDateTimeISO(zona);
  return {
    fecha: zdt.toPlainDate().toString(),
    hora: zdt.toPlainTime().toString({ smallestUnit: 'minute' }),
  };
}

/** Rango [desde 00:00, hasta+1 00:00) en la zona del centro → instantes. */
export function rangoDeFechas(desde: string, hasta: string, zona: string) {
  return {
    desde: aInstante(desde, '00:00', zona),
    hasta: new Date(
      Temporal.PlainDate.from(hasta)
        .add({ days: 1 })
        .toZonedDateTime({ timeZone: zona }).epochMilliseconds,
    ),
  };
}

/** Días entre dos fechas (hasta − desde). */
export function diasEntre(desde: string, hasta: string): number {
  return Temporal.PlainDate.from(desde).until(Temporal.PlainDate.from(hasta), {
    largestUnit: 'days',
  }).days;
}

/**
 * Fechas de un día de la semana (1 = lunes … 7 = domingo) entre desde y hasta,
 * ambas incluidas.
 */
export function fechasSemanales(
  diaSemana: number,
  desde: string,
  hasta: string,
): string[] {
  let d = Temporal.PlainDate.from(desde);
  const fin = Temporal.PlainDate.from(hasta);
  d = d.add({ days: (diaSemana - d.dayOfWeek + 7) % 7 });
  const fechas: string[] = [];
  while (Temporal.PlainDate.compare(d, fin) <= 0) {
    fechas.push(d.toString());
    d = d.add({ weeks: 1 });
  }
  return fechas;
}

export function sumarDias(fecha: string, dias: number): string {
  return Temporal.PlainDate.from(fecha).add({ days: dias }).toString();
}

const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];

/** "mar 10/11 10:00" en la zona del centro, para mensajes. Armado a mano para no depender del ICU. */
export function formatoCorto(instante: Date, zona: string): string {
  const zdt = Temporal.Instant.fromEpochMilliseconds(
    instante.getTime(),
  ).toZonedDateTimeISO(zona);
  const dd = String(zdt.day).padStart(2, '0');
  const mm = String(zdt.month).padStart(2, '0');
  const hora = zdt.toPlainTime().toString({ smallestUnit: 'minute' });
  return `${DIAS[zdt.dayOfWeek - 1]} ${dd}/${mm} ${hora}`;
}

/** Mes "AAAA-MM". */
export const mesTexto = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'formato AAAA-MM');

/** "2026-11" → Date 2026-11-01 a medianoche UTC, como guarda PostgreSQL un DATE. */
export function periodoDe(mes: string): Date {
  return new Date(`${mes}-01T00:00:00Z`);
}

/** Primer y último día de un mes "AAAA-MM". */
export function diasDelMes(mes: string): { primero: string; ultimo: string } {
  const primero = `${mes}-01`;
  const ultimo = Temporal.PlainDate.from(primero)
    .add({ months: 1 })
    .subtract({ days: 1 })
    .toString();
  return { primero, ultimo };
}

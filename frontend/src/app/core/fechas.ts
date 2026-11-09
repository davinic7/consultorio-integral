/**
 * Fechas de calendario como texto "AAAA-MM-DD". La API ya devuelve fecha y hora
 * en la zona del centro, así que acá solo se hace aritmética de días (en UTC,
 * para que la zona del navegador no mueva nada).
 */

const DIAS_CORTOS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const DIAS_LARGOS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function aDate(fecha: string): Date {
  return new Date(`${fecha}T00:00:00Z`);
}

function aTexto(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Fecha de hoy en una zona horaria. */
export function hoyEn(zona = 'America/Argentina/Catamarca'): string {
  // en-CA formatea como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export function sumarDias(fecha: string, dias: number): string {
  const d = aDate(fecha);
  d.setUTCDate(d.getUTCDate() + dias);
  return aTexto(d);
}

/** 1 = lunes … 7 = domingo. */
export function diaSemana(fecha: string): number {
  return ((aDate(fecha).getUTCDay() + 6) % 7) + 1;
}

export function lunesDe(fecha: string): string {
  return sumarDias(fecha, 1 - diaSemana(fecha));
}

export function diasDesde(desde: string, cantidad: number): string[] {
  return Array.from({ length: cantidad }, (_, i) => sumarDias(desde, i));
}

/** "mar 17" */
export function etiquetaDia(fecha: string): string {
  return `${DIAS_CORTOS[diaSemana(fecha) - 1]} ${Number(fecha.slice(8, 10))}`;
}

/** "martes 17 de noviembre" */
export function fechaLarga(fecha: string): string {
  const d = aDate(fecha);
  return `${DIAS_LARGOS[diaSemana(fecha) - 1]} ${d.getUTCDate()} de ${MESES[d.getUTCMonth()]}`;
}

/** "16 al 22 de noviembre de 2026" (o con meses distintos). */
export function rangoLegible(desde: string, hasta: string): string {
  const a = aDate(desde);
  const b = aDate(hasta);
  const mismoMes = a.getUTCMonth() === b.getUTCMonth();
  return mismoMes
    ? `${a.getUTCDate()} al ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]} de ${b.getUTCFullYear()}`
    : `${a.getUTCDate()} de ${MESES[a.getUTCMonth()]} al ${b.getUTCDate()} de ${MESES[b.getUTCMonth()]} de ${b.getUTCFullYear()}`;
}

export const NOMBRE_DIA = DIAS_LARGOS;

/** "HH:MM" → minutos desde 00:00. */
export function minutos(hora: string): number {
  const [h, m] = hora.split(':').map(Number);
  return h * 60 + m;
}

/** Fecha y minutos desde las 00:00 de ahora, en una zona horaria. */
export function ahoraEn(zona = 'America/Argentina/Catamarca'): { fecha: string; minutos: number } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '00';
  return {
    fecha: `${v('year')}-${v('month')}-${v('day')}`,
    minutos: Number(v('hour')) * 60 + Number(v('minute')),
  };
}

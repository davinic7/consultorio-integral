import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Adaptador de PostgreSQL para Prisma con la sesión siempre en UTC.
 *
 * El adaptador manda y lee las fechas `timestamptz` como hora "de pared" sin zona;
 * si la base tiene otra zona horaria (una instalación local en Argentina, por
 * ejemplo) cada fecha queda corrida unas horas. Con la sesión en UTC lo que se
 * guarda es el instante exacto, en cualquier servidor.
 */
export function adaptadorPg(connectionString: string): PrismaPg {
  return new PrismaPg({ connectionString, options: '-c TimeZone=UTC' });
}

import { z } from 'zod';

/** Booleano en query string: "true"/"1" → true, "false"/"0" → false. */
export const boolQuery = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/** Parámetros de listado paginado con búsqueda. */
export const listadoSchema = z.object({
  q: z.string().trim().max(100).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
  incluirInactivos: boolQuery.optional(),
});
export type ListadoDto = z.infer<typeof listadoSchema>;

export interface Pagina<T> {
  items: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

/** Fecha sin hora (YYYY-MM-DD) → Date a medianoche UTC, como la guarda PostgreSQL (DATE). */
export const fechaSolo = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'formato AAAA-MM-DD')
  .transform((s) => new Date(`${s}T00:00:00Z`))
  .refine((d) => !Number.isNaN(d.getTime()), 'fecha inválida');

/** Date de una columna DATE → "YYYY-MM-DD". */
export function aFechaSolo(d: Date | null): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/** Texto opcional: vacío se guarda como null. */
export const textoOpcional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((s) => (s === '' ? null : s))
    .nullable()
    .optional();

export const textoObligatorio = (max: number) =>
  z.string().trim().min(1, 'obligatorio').max(max);

/** Id en la URL. */
export const idParam = z.uuid('id inválido');

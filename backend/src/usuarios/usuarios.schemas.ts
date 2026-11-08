import { z } from 'zod';
import { email, passwordNueva } from '../common/zod.js';
import { Rol } from '../generated/prisma/enums.js';

export const rolSchema = z.enum(Rol);

export const crearMiembroSchema = z.object({
  email,
  nombre: z.string().trim().min(1).max(120),
  rol: rolSchema,
  /** Obligatoria si el email todavía no tiene cuenta; se ignora si ya existe. */
  password: passwordNueva.optional(),
});
export type CrearMiembroDto = z.infer<typeof crearMiembroSchema>;

export const actualizarMiembroSchema = z
  .object({ rol: rolSchema.optional(), activo: z.boolean().optional() })
  .refine(
    (d) => d.rol !== undefined || d.activo !== undefined,
    'indicá rol o activo',
  );
export type ActualizarMiembroDto = z.infer<typeof actualizarMiembroSchema>;

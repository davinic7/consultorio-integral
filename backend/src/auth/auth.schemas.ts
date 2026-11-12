import { z } from 'zod';
import { email } from '../common/zod.js';

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
  /** Centro con el que entrar. Si se omite y el usuario tiene uno solo, entra a ese. */
  centroId: z.uuid().optional(),
  /** Web: la cookie de sesión sobrevive a cerrar el navegador ("Recordarme"). */
  recordar: z.boolean().optional(),
});
export type LoginDto = z.infer<typeof loginSchema>;

/** La web lo omite: el token viaja en la cookie httpOnly (ver cookie-sesion.ts). */
export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200).optional(),
  recordar: z.boolean().optional(),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

export const cambiarCentroSchema = z.object({
  centroId: z.uuid(),
  recordar: z.boolean().optional(),
});
export type CambiarCentroDto = z.infer<typeof cambiarCentroSchema>;

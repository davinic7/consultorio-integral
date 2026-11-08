import { z } from 'zod';
import { email } from '../common/zod.js';

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
  /** Centro con el que entrar. Si se omite y el usuario tiene uno solo, entra a ese. */
  centroId: z.uuid().optional(),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(200),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

export const cambiarCentroSchema = z.object({
  centroId: z.uuid(),
});
export type CambiarCentroDto = z.infer<typeof cambiarCentroSchema>;

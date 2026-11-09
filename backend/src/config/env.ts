import { z } from 'zod';

/** Variables de entorno validadas al arrancar: si falta algo, la app no levanta. */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().url(),
  /** Orígenes permitidos para CORS, separados por coma (web, app móvil). */
  CORS_ORIGINS: z.string().default('http://localhost:4200'),
  /** Clave para firmar los access tokens (JWT). Mínimo 32 caracteres, al azar. */
  JWT_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
  /** Vida del access token, en segundos (15 minutos por defecto). */
  ACCESS_TOKEN_TTL_SEG: z.coerce.number().int().positive().default(900),
  /** Vida del refresh token, en días. */
  REFRESH_TOKEN_TTL_DIAS: z.coerce.number().int().positive().default(30),
  /**
   * Carpeta con la app Angular compilada (frontend/dist/frontend/browser).
   * Si se define, la API también sirve la web. En desarrollo no hace falta.
   */
  FRONTEND_DIR: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const detalle = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Variables de entorno inválidas:\n${detalle}`);
  }
  return result.data;
}

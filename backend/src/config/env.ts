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

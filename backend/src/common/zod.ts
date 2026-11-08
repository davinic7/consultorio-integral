import { applyDecorators } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

/** Documenta en OpenAPI el cuerpo validado con un schema de Zod. */
export function ApiBodyZod(schema: z.ZodType) {
  const jsonSchema = z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io: 'input',
  });
  return applyDecorators(
    ApiBody({ schema: jsonSchema as Record<string, unknown> }),
  );
}

export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('email inválido').max(160));

/** Contraseña nueva: al menos 10 caracteres. */
export const passwordNueva = z
  .string()
  .min(10, 'al menos 10 caracteres')
  .max(200);

import {
  INestApplication,
  StandardSchemaValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { Env } from './config/env.js';

/**
 * Configuración HTTP común a la app y a los tests e2e.
 * Rutas: /api/v1/... (versionadas: las apps móviles instaladas tardan en actualizarse).
 */
export function setupApp(app: INestApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors({
    origin: config
      .get('CORS_ORIGINS', { infer: true })
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    credentials: true,
  });
  // Valida con Zod los parámetros declarados como @Body({ schema }), @Param(..., { schema }), etc.
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.enableShutdownHooks();

  const documento = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Centro Integral API')
      .setDescription('API del SaaS para centros de atención integral')
      .setVersion('1')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, documento, {
    jsonDocumentUrl: 'api/openapi.json',
  });
}

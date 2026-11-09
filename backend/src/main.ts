import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { servirFrontend } from './servir-frontend.js';
import { setupApp } from './setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  if (config.get('NODE_ENV', { infer: true }) === 'production') {
    // Detrás del proxy de la plataforma (Render, Railway…): la IP real viene en
    // X-Forwarded-For. Sin esto, el límite de intentos de login sería uno para todos.
    app.set('trust proxy', 1);
  }

  setupApp(app);

  const frontend = config.get('FRONTEND_DIR', { infer: true });
  if (frontend) servirFrontend(app, frontend);

  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();

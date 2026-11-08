import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import type { Env } from './config/env.js';
import { setupApp } from './setup-app.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  const port = app
    .get<ConfigService<Env, true>>(ConfigService)
    .get('PORT', { infer: true });
  await app.listen(port);
}
await bootstrap();

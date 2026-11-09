import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * En producción, la API también sirve la app Angular ya compilada: un solo
 * servicio y un solo dominio, sin CORS, y la web usa /api/v1 igual que en desarrollo.
 *
 * - Archivos con hash en el nombre (main-ABC123.js): caché de un año.
 * - index.html: sin caché, para que cada versión nueva se vea al recargar.
 * - Cualquier otra ruta que no sea /api (ej. /agenda) devuelve index.html y la
 *   resuelve el router de Angular.
 */
export function servirFrontend(app: NestExpressApplication, dir: string): void {
  const index = join(dir, 'index.html');
  if (!existsSync(index)) {
    throw new Error(`FRONTEND_DIR: no se encontró ${index}`);
  }

  app.useStaticAssets(dir, {
    index: false,
    maxAge: '1y',
    immutable: true,
    setHeaders: (res, ruta) => {
      if (ruta.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const esApi = req.path === '/api' || req.path.startsWith('/api/');
    if (req.method !== 'GET' || esApi || !req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
}

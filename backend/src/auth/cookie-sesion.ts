import type { Request, Response } from 'express';
import type { RespuestaSesion } from './auth.service.js';

/**
 * Refresh token de la web en una cookie httpOnly: el JavaScript de la página no
 * lo puede leer, así que un XSS no se lo lleva.
 *
 * - La web avisa con el encabezado `X-Sesion: cookie`. Recibe la cookie y la
 *   respuesta viene sin `refreshToken`.
 * - La app móvil no manda el encabezado: recibe el token en el cuerpo y lo guarda
 *   en el almacenamiento seguro del sistema, como hasta ahora.
 *
 * CSRF: la cookie solo se usa si el pedido trae ese encabezado, que un sitio ajeno
 * no puede agregar sin pasar por CORS; además es SameSite=Strict y solo viaja a
 * las rutas de auth.
 */
export const COOKIE_REFRESH = 'ci_refresh';
const RUTA = '/api/v1/auth';
const ENCABEZADO = 'x-sesion';

export function usaCookie(req: Request): boolean {
  return req.headers[ENCABEZADO] === 'cookie';
}

/** El refresh token del cuerpo o, para la web, el de la cookie. */
export function refreshDe(req: Request, delCuerpo?: string): string | null {
  if (delCuerpo) return delCuerpo;
  if (!usaCookie(req)) return null;
  return leerCookie(req, COOKIE_REFRESH);
}

/**
 * Para la web pone la cookie y saca el token de la respuesta.
 * `recordar`: la cookie dura lo que el refresh token; si no, hasta cerrar el navegador.
 */
export function responderSesion(
  req: Request,
  res: Response,
  r: RespuestaSesion,
  opciones: { recordar: boolean; dias: number; segura: boolean },
): RespuestaSesion | Omit<RespuestaSesion, 'refreshToken'> {
  if (!usaCookie(req)) return r;
  const { refreshToken, ...resto } = r;
  res.cookie(COOKIE_REFRESH, refreshToken, {
    httpOnly: true,
    secure: opciones.segura,
    sameSite: 'strict',
    path: RUTA,
    ...(opciones.recordar ? { maxAge: opciones.dias * 86_400_000 } : {}),
  });
  return resto;
}

export function borrarCookie(req: Request, res: Response, segura: boolean) {
  if (!usaCookie(req)) return;
  res.clearCookie(COOKIE_REFRESH, {
    httpOnly: true,
    secure: segura,
    sameSite: 'strict',
    path: RUTA,
  });
}

function leerCookie(req: Request, nombre: string): string | null {
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) {
      try {
        return decodeURIComponent(parte.slice(i + 1).trim()) || null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

import type { Rol } from '../generated/prisma/client.js';

/** Contenido del access token (JWT). */
export interface PayloadToken {
  /** usuarioId */
  sub: string;
  /** sesionId */
  sid: string;
  /** centroId elegido en la sesión */
  cid: string | null;
  rol: Rol | null;
  sa: boolean;
}

/** Usuario ya autenticado, disponible en request.usuario. */
export interface UsuarioAutenticado {
  usuarioId: string;
  sesionId: string;
  centroId: string | null;
  rol: Rol | null;
  esSuperadmin: boolean;
}

declare module 'express' {
  interface Request {
    usuario?: UsuarioAutenticado;
  }
}

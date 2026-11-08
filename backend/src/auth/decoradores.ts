import {
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Rol } from '../generated/prisma/client.js';
import type { UsuarioAutenticado } from './auth.types.js';

export const CLAVE_PUBLICO = 'auth:publico';
export const CLAVE_ROLES = 'auth:roles';
export const CLAVE_SUPERADMIN = 'auth:superadmin';

/** Ruta sin login (todas las demás lo exigen). */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

/** Exige un centro elegido y alguno de estos roles en él. */
export const Roles = (...roles: Rol[]) => SetMetadata(CLAVE_ROLES, roles);

/** Solo el superadministrador de la plataforma. */
export const SoloSuperadmin = () => SetMetadata(CLAVE_SUPERADMIN, true);

export const UsuarioActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): UsuarioAutenticado =>
    ctx.switchToHttp().getRequest<Request>().usuario!,
);

/** centroId de la sesión. Falla con 403 si la sesión no tiene centro elegido. */
export const CentroActual = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string => {
    const centroId = ctx.switchToHttp().getRequest<Request>().usuario?.centroId;
    if (!centroId)
      throw new ForbiddenException('Elegí un centro para continuar');
    return centroId;
  },
);

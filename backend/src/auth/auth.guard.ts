import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { Modulo, Rol } from '../generated/prisma/client.js';
import {
  CLAVE_MODULO,
  ModulosCentro,
  NOMBRE_MODULO,
} from '../planes/planes.js';
import type { PayloadToken } from './auth.types.js';
import { CLAVE_PUBLICO, CLAVE_ROLES, CLAVE_SUPERADMIN } from './decoradores.js';

/**
 * Guard global: toda ruta exige un access token válido salvo @Publico().
 * Además aplica @Roles(...) (rol en el centro de la sesión), @SoloSuperadmin() y
 * @RequiereModulo(...) (el plan del centro tiene que incluir ese módulo).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly modulos: ModulosCentro,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const destino = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, destino))
      return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const [tipo, token] = req.headers.authorization?.split(' ') ?? [];
    if (tipo !== 'Bearer' || !token)
      throw new UnauthorizedException('Falta iniciar sesión');

    let payload: PayloadToken;
    try {
      payload = await this.jwt.verifyAsync<PayloadToken>(token);
    } catch {
      throw new UnauthorizedException('Sesión vencida o inválida');
    }
    req.usuario = {
      usuarioId: payload.sub,
      sesionId: payload.sid,
      centroId: payload.cid,
      rol: payload.rol,
      esSuperadmin: payload.sa,
    };

    if (
      this.reflector.getAllAndOverride<boolean>(CLAVE_SUPERADMIN, destino) &&
      !payload.sa
    ) {
      throw new ForbiddenException('Solo para el superadministrador');
    }
    const roles = this.reflector.getAllAndOverride<Rol[] | undefined>(
      CLAVE_ROLES,
      destino,
    );
    if (roles?.length) {
      if (!payload.cid)
        throw new ForbiddenException('Elegí un centro para continuar');
      if (!payload.rol || !roles.includes(payload.rol)) {
        throw new ForbiddenException('Tu rol no tiene acceso a esta sección');
      }
    }
    const modulos = this.reflector.getAllAndOverride<Modulo[] | undefined>(
      CLAVE_MODULO,
      destino,
    );
    if (modulos?.length) {
      if (!payload.cid)
        throw new ForbiddenException('Elegí un centro para continuar');
      const delPlan = await this.modulos.de(payload.cid);
      const falta = modulos.find((m) => !delPlan.has(m));
      if (falta) {
        throw new ForbiddenException(
          `El plan del centro no incluye ${NOMBRE_MODULO[falta]}`,
        );
      }
    }
    return true;
  }
}

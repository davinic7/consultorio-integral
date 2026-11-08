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
import type { Rol } from '../generated/prisma/client.js';
import type { PayloadToken } from './auth.types.js';
import { CLAVE_PUBLICO, CLAVE_ROLES, CLAVE_SUPERADMIN } from './decoradores.js';

/**
 * Guard global: toda ruta exige un access token válido salvo @Publico().
 * Además aplica @Roles(...) (rol en el centro de la sesión) y @SoloSuperadmin().
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
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
    return true;
  }
}

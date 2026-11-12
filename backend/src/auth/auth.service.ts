import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { Env } from '../config/env.js';
import type {
  Centro,
  Miembro,
  Modulo,
  Rol,
  Usuario,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { PayloadToken, UsuarioAutenticado } from './auth.types.js';
import { hashSenuelo, verificarPassword } from './password.js';

const INCLUDE_CENTRO = {
  centro: {
    include: {
      plan: {
        select: {
          codigo: true,
          nombre: true,
          modulos: { select: { modulo: true } },
        },
      },
    },
  },
} as const;
type CentroConPlan = Centro & {
  plan: { codigo: string; nombre: string; modulos: { modulo: Modulo }[] };
};
type MiembroConCentro = Miembro & { centro: CentroConPlan };

export interface CentroDeUsuario {
  id: string;
  nombre: string;
  slug: string;
  zonaHoraria: string;
  rol: Rol;
}

export interface RespuestaSesion {
  accessToken: string;
  accessTokenExpiraEn: string;
  refreshToken: string;
  usuario: { id: string; email: string; nombre: string; esSuperadmin: boolean };
  /** Centro de esta sesión (null si todavía no eligió o es superadmin sin centro). */
  centro: {
    id: string;
    nombre: string;
    slug: string;
    zonaHoraria: string;
    /** Plan del centro y módulos que habilita. */
    plan: { codigo: string; nombre: string };
    modulos: Modulo[];
  } | null;
  rol: Rol | null;
  /** Tiene una ficha de profesional activa en el centro (atiende pacientes). */
  atiende: boolean;
  /** Centros a los que puede entrar. */
  centros: CentroDeUsuario[];
}

const CREDENCIALES_INVALIDAS = 'Email o contraseña incorrectos';
const SESION_INVALIDA = 'Sesión vencida o inválida; volvé a iniciar sesión';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(
    email: string,
    password: string,
    centroId: string | undefined,
    userAgent?: string,
  ): Promise<RespuestaSesion> {
    const usuario = await this.prisma.usuario.findUnique({ where: { email } });
    // Siempre se verifica un hash, exista o no el usuario, para no revelarlo por el tiempo de respuesta.
    const ok = await verificarPassword(
      password,
      usuario?.passwordHash ?? (await hashSenuelo()),
    );
    if (!usuario || !usuario.activo || !ok)
      throw new UnauthorizedException(CREDENCIALES_INVALIDAS);

    const miembros = await this.miembrosActivos(usuario.id);
    let miembro: MiembroConCentro | null = null;
    if (centroId) {
      miembro = miembros.find((m) => m.centroId === centroId) ?? null;
      if (!miembro)
        throw new ForbiddenException('No tenés acceso a ese centro');
    } else if (miembros.length === 1) {
      miembro = miembros[0];
    }
    return (await this.emitir(usuario, miembro, miembros, userAgent)).respuesta;
  }

  /** Rota el refresh token: el usado queda revocado y se entrega uno nuevo. */
  async refresh(
    refreshToken: string,
    userAgent?: string,
  ): Promise<RespuestaSesion> {
    const sesion = await this.prisma.sesion.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { usuario: true },
    });
    if (!sesion) throw new UnauthorizedException(SESION_INVALIDA);

    // Revocación condicional: si otro pedido ya la rotó, count es 0.
    const { count } = await this.prisma.sesion.updateMany({
      where: { id: sesion.id, revocadaEn: null, expiraEn: { gt: new Date() } },
      data: { revocadaEn: new Date() },
    });
    if (count === 0) {
      if (sesion.revocadaEn) {
        // Un token ya rotado volvió a usarse: posible robo. Se cierran todas las sesiones.
        await this.revocarTodas(sesion.usuarioId);
      }
      throw new UnauthorizedException(SESION_INVALIDA);
    }

    if (!sesion.usuario.activo)
      throw new UnauthorizedException(SESION_INVALIDA);
    const miembros = await this.miembrosActivos(sesion.usuarioId);
    let miembro: MiembroConCentro | null = null;
    if (sesion.centroId) {
      miembro = miembros.find((m) => m.centroId === sesion.centroId) ?? null;
      if (!miembro)
        throw new UnauthorizedException('Ya no tenés acceso a este centro');
    }
    const nueva = await this.emitir(
      sesion.usuario,
      miembro,
      miembros,
      userAgent,
    );
    await this.prisma.sesion.update({
      where: { id: sesion.id },
      data: { reemplazadaPorId: nueva.sesionId },
    });
    return nueva.respuesta;
  }

  /** Cambia el centro de la sesión actual. */
  async cambiarCentro(
    actual: UsuarioAutenticado,
    centroId: string,
    userAgent?: string,
  ): Promise<RespuestaSesion> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: actual.usuarioId },
    });
    if (!usuario?.activo) throw new UnauthorizedException(SESION_INVALIDA);
    const miembros = await this.miembrosActivos(usuario.id);
    const miembro = miembros.find((m) => m.centroId === centroId);
    if (!miembro) throw new ForbiddenException('No tenés acceso a ese centro');
    await this.prisma.sesion.updateMany({
      where: { id: actual.sesionId, revocadaEn: null },
      data: { revocadaEn: new Date() },
    });
    return (await this.emitir(usuario, miembro, miembros, userAgent)).respuesta;
  }

  async logout(refreshToken: string): Promise<void> {
    await this.prisma.sesion.updateMany({
      where: { tokenHash: hashToken(refreshToken), revocadaEn: null },
      data: { revocadaEn: new Date() },
    });
  }

  async yo(actual: UsuarioAutenticado) {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: actual.usuarioId },
    });
    const miembros = await this.miembrosActivos(usuario.id);
    const miembro =
      miembros.find((m) => m.centroId === actual.centroId) ?? null;
    return {
      usuario: this.datosUsuario(usuario),
      centro: miembro ? this.datosCentro(miembro.centro) : null,
      rol: miembro?.rol ?? null,
      atiende: await this.atiende(usuario.id, miembro?.centroId ?? null),
      centros: miembros.map((m) => this.centroDeUsuario(m)),
    };
  }

  async revocarTodas(usuarioId: string): Promise<void> {
    await this.prisma.sesion.updateMany({
      where: { usuarioId, revocadaEn: null },
      data: { revocadaEn: new Date() },
    });
  }

  // ───────── internos ─────────

  private miembrosActivos(usuarioId: string): Promise<MiembroConCentro[]> {
    return this.prisma.miembro.findMany({
      where: { usuarioId, activo: true, centro: { activo: true } },
      include: INCLUDE_CENTRO,
      orderBy: { centro: { nombre: 'asc' } },
    });
  }

  private async emitir(
    usuario: Usuario,
    miembro: MiembroConCentro | null,
    miembros: MiembroConCentro[],
    userAgent?: string,
  ): Promise<{ respuesta: RespuestaSesion; sesionId: string }> {
    const refreshToken = randomBytes(32).toString('base64url');
    const dias = this.config.get('REFRESH_TOKEN_TTL_DIAS', { infer: true });
    const sesion = await this.prisma.sesion.create({
      data: {
        usuarioId: usuario.id,
        centroId: miembro?.centroId ?? null,
        tokenHash: hashToken(refreshToken),
        expiraEn: new Date(Date.now() + dias * 86_400_000),
        userAgent: userAgent?.slice(0, 255),
      },
    });

    const ttl = this.config.get('ACCESS_TOKEN_TTL_SEG', { infer: true });
    const payload: PayloadToken = {
      sub: usuario.id,
      sid: sesion.id,
      cid: miembro?.centroId ?? null,
      rol: miembro?.rol ?? null,
      sa: usuario.esSuperadmin,
    };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn: ttl });

    const respuesta: RespuestaSesion = {
      accessToken,
      accessTokenExpiraEn: new Date(Date.now() + ttl * 1000).toISOString(),
      refreshToken,
      usuario: this.datosUsuario(usuario),
      centro: miembro ? this.datosCentro(miembro.centro) : null,
      rol: miembro?.rol ?? null,
      atiende: await this.atiende(usuario.id, miembro?.centroId ?? null),
      centros: miembros.map((m) => this.centroDeUsuario(m)),
    };
    return { respuesta, sesionId: sesion.id };
  }

  private async atiende(
    usuarioId: string,
    centroId: string | null,
  ): Promise<boolean> {
    if (!centroId) return false;
    const yo = await this.prisma.paraCentro(centroId).profesional.findFirst({
      where: { usuarioId, activo: true },
      select: { id: true },
    });
    return yo !== null;
  }

  private datosUsuario(u: Usuario) {
    return {
      id: u.id,
      email: u.email,
      nombre: u.nombre,
      esSuperadmin: u.esSuperadmin,
    };
  }

  private datosCentro(c: CentroConPlan) {
    return {
      id: c.id,
      nombre: c.nombre,
      slug: c.slug,
      zonaHoraria: c.zonaHoraria,
      plan: { codigo: c.plan.codigo, nombre: c.plan.nombre },
      modulos: c.plan.modulos.map((m) => m.modulo),
    };
  }

  private centroDeUsuario(m: MiembroConCentro): CentroDeUsuario {
    const { id, nombre, slug, zonaHoraria } = m.centro;
    return { id, nombre, slug, zonaHoraria, rol: m.rol };
  }
}

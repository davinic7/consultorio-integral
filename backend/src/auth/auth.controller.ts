import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApiBodyZod } from '../common/zod.js';
import type { Env } from '../config/env.js';
import {
  cambiarCentroSchema,
  loginSchema,
  refreshSchema,
  type CambiarCentroDto,
  type LoginDto,
  type RefreshDto,
} from './auth.schemas.js';
import { AuthService, type RespuestaSesion } from './auth.service.js';
import type { UsuarioAutenticado } from './auth.types.js';
import { borrarCookie, refreshDe, responderSesion } from './cookie-sesion.js';
import { Publico, UsuarioActual } from './decoradores.js';

/** Límite de intentos de login por IP y por minuto (configurable para tests). */
const LIMITE_LOGIN = Number(process.env.LOGIN_LIMITE_POR_MIN ?? 10);

@ApiTags('auth')
@ApiHeader({
  name: 'X-Sesion',
  required: false,
  description:
    'La web manda "cookie": el refresh token viaja en una cookie httpOnly y no en el cuerpo.',
})
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Publico()
  @Throttle({ default: { limit: LIMITE_LOGIN, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(loginSchema)
  async login(
    @Body({ schema: loginSchema }) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    const r = await this.auth.login(
      dto.email,
      dto.password,
      dto.centroId,
      userAgent,
    );
    return this.responder(req, res, r, dto.recordar);
  }

  @Publico()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(refreshSchema)
  async refresh(
    @Body({ schema: refreshSchema }) dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    const token = refreshDe(req, dto.refreshToken);
    if (!token) throw new UnauthorizedException('Falta el refresh token');
    try {
      const r = await this.auth.refresh(token, userAgent);
      return this.responder(req, res, r, dto.recordar);
    } catch (e) {
      // Sesión inválida: que la web no siga mandando una cookie vieja.
      borrarCookie(req, res, this.segura());
      throw e;
    }
  }

  @Publico()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBodyZod(refreshSchema)
  async logout(
    @Body({ schema: refreshSchema }) dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    const token = refreshDe(req, dto.refreshToken);
    borrarCookie(req, res, this.segura());
    if (token) await this.auth.logout(token);
  }

  @ApiBearerAuth()
  @Post('centro')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(cambiarCentroSchema)
  async cambiarCentro(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body({ schema: cambiarCentroSchema }) dto: CambiarCentroDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent?: string,
  ) {
    const r = await this.auth.cambiarCentro(usuario, dto.centroId, userAgent);
    return this.responder(req, res, r, dto.recordar);
  }

  @ApiBearerAuth()
  @Get('yo')
  yo(@UsuarioActual() usuario: UsuarioAutenticado) {
    return this.auth.yo(usuario);
  }

  private responder(
    req: Request,
    res: Response,
    r: RespuestaSesion,
    recordar = false,
  ) {
    return responderSesion(req, res, r, {
      recordar,
      dias: this.config.get('REFRESH_TOKEN_TTL_DIAS', { infer: true }),
      segura: this.segura(),
    });
  }

  /** En producción la cookie solo viaja por HTTPS. */
  private segura(): boolean {
    return this.config.get('NODE_ENV', { infer: true }) === 'production';
  }
}

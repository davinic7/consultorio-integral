import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiBodyZod } from '../common/zod.js';
import {
  cambiarCentroSchema,
  loginSchema,
  refreshSchema,
  type CambiarCentroDto,
  type LoginDto,
  type RefreshDto,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';
import type { UsuarioAutenticado } from './auth.types.js';
import { Publico, UsuarioActual } from './decoradores.js';

/** Límite de intentos de login por IP y por minuto (configurable para tests). */
const LIMITE_LOGIN = Number(process.env.LOGIN_LIMITE_POR_MIN ?? 10);

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Publico()
  @Throttle({ default: { limit: LIMITE_LOGIN, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(loginSchema)
  login(
    @Body({ schema: loginSchema }) dto: LoginDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.login(dto.email, dto.password, dto.centroId, userAgent);
  }

  @Publico()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(refreshSchema)
  refresh(
    @Body({ schema: refreshSchema }) dto: RefreshDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.refresh(dto.refreshToken, userAgent);
  }

  @Publico()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBodyZod(refreshSchema)
  async logout(
    @Body({ schema: refreshSchema }) dto: RefreshDto,
  ): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @ApiBearerAuth()
  @Post('centro')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(cambiarCentroSchema)
  cambiarCentro(
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Body({ schema: cambiarCentroSchema }) dto: CambiarCentroDto,
    @Headers('user-agent') userAgent?: string,
  ) {
    return this.auth.cambiarCentro(usuario, dto.centroId, userAgent);
  }

  @ApiBearerAuth()
  @Get('yo')
  yo(@UsuarioActual() usuario: UsuarioAutenticado) {
    return this.auth.yo(usuario);
  }
}

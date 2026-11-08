import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { ApiBodyZod } from '../common/zod.js';
import { Rol } from '../generated/prisma/enums.js';
import {
  actualizarMiembroSchema,
  crearMiembroSchema,
  type ActualizarMiembroDto,
  type CrearMiembroDto,
} from './usuarios.schemas.js';
import { UsuariosService } from './usuarios.service.js';

@ApiTags('usuarios')
@ApiBearerAuth()
@Roles(Rol.admin)
@Controller('usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  listar(@CentroActual() centroId: string) {
    return this.usuarios.listar(centroId);
  }

  @Post()
  @ApiBodyZod(crearMiembroSchema)
  crear(
    @CentroActual() centroId: string,
    @Body({ schema: crearMiembroSchema }) dto: CrearMiembroDto,
  ) {
    return this.usuarios.crear(centroId, dto);
  }

  @Patch(':id')
  @ApiBodyZod(actualizarMiembroSchema)
  actualizar(
    @CentroActual() centroId: string,
    @UsuarioActual() usuario: UsuarioAutenticado,
    @Param('id', { schema: z.uuid() }) id: string,
    @Body({ schema: actualizarMiembroSchema }) dto: ActualizarMiembroDto,
  ) {
    return this.usuarios.actualizar(centroId, id, usuario.usuarioId, dto);
  }
}

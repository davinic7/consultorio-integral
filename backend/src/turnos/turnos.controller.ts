import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { AvisosModule } from '../avisos/avisos.js';
import { idParam } from '../common/comunes.js';
import { ApiBodyZod } from '../common/zod.js';
import { Rol } from '../generated/prisma/client.js';
import {
  cancelarTurnoSchema,
  crearRecurrenciaSchema,
  crearTurnoSchema,
  finalizarRecurrenciaSchema,
  listarTurnosSchema,
  marcarAsistenciaSchema,
  moverTurnoSchema,
  rangoSchema,
  type CancelarTurnoDto,
  type CrearRecurrenciaDto,
  type CrearTurnoDto,
  type ListarTurnosDto,
  type MarcarAsistenciaDto,
  type MoverTurnoDto,
} from './turnos.schemas.js';
import { TurnosService } from './turnos.service.js';

/**
 * Agenda. Admin y recepción gestionan todos los turnos; un profesional ve y
 * gestiona solo los suyos, y cada cambio suyo avisa a admin y recepción.
 */
@ApiTags('turnos')
@ApiBearerAuth()
@Roles(Rol.admin, Rol.recepcion, Rol.profesional)
@Controller('turnos')
export class TurnosController {
  constructor(private readonly turnos: TurnosService) {}

  @Get()
  listar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: listarTurnosSchema }) q: ListarTurnosDto,
  ) {
    return this.turnos.listar(centroId, quien, q);
  }

  /** Salas y profesionales ocupados en el rango, sin datos de pacientes. */
  @Get('ocupacion')
  ocupacion(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: rangoSchema }) q: z.infer<typeof rangoSchema>,
  ) {
    return this.turnos.ocupacion(centroId, quien, q.desde, q.hasta);
  }

  @Get(':id')
  obtener(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.turnos.obtener(centroId, quien, id);
  }

  @Post()
  @ApiBodyZod(crearTurnoSchema)
  crear(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Body({ schema: crearTurnoSchema }) dto: CrearTurnoDto,
  ) {
    return this.turnos.crear(centroId, quien, dto);
  }

  @Patch(':id')
  @ApiBodyZod(moverTurnoSchema)
  mover(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: moverTurnoSchema }) dto: MoverTurnoDto,
  ) {
    return this.turnos.mover(centroId, quien, id, dto);
  }

  @Post(':id/cancelar')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(cancelarTurnoSchema)
  cancelar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: cancelarTurnoSchema }) dto: CancelarTurnoDto,
  ) {
    return this.turnos.cancelar(centroId, quien, id, dto);
  }

  /** Presente, ausente con o sin aviso, o de vuelta a pendiente para corregir. */
  @Post(':id/asistencia')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(marcarAsistenciaSchema)
  marcarAsistencia(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: marcarAsistenciaSchema }) dto: MarcarAsistenciaDto,
  ) {
    return this.turnos.marcarAsistencia(centroId, quien, id, dto);
  }

  /** Quién cambió la asistencia del turno y cuándo. */
  @Get(':id/asistencia/cambios')
  cambiosDeAsistencia(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.turnos.cambiosDeAsistencia(centroId, quien, id);
  }
}

@ApiTags('turnos')
@ApiBearerAuth()
@Roles(Rol.admin, Rol.recepcion, Rol.profesional)
@Controller('recurrencias')
export class RecurrenciasController {
  constructor(private readonly turnos: TurnosService) {}

  @Post()
  @ApiBodyZod(crearRecurrenciaSchema)
  crear(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Body({ schema: crearRecurrenciaSchema }) dto: CrearRecurrenciaDto,
  ) {
    return this.turnos.crearRecurrencia(centroId, quien, dto);
  }

  @Post(':id/finalizar')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(finalizarRecurrenciaSchema)
  finalizar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: finalizarRecurrenciaSchema })
    dto: z.infer<typeof finalizarRecurrenciaSchema>,
  ) {
    return this.turnos.finalizarRecurrencia(centroId, quien, id, dto.desde);
  }
}

@Module({
  imports: [AvisosModule],
  controllers: [TurnosController, RecurrenciasController],
  providers: [TurnosService],
})
export class TurnosModule {}

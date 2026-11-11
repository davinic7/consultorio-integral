import { RequiereModulo } from '../planes/planes.js';
import {
  Body,
  Controller,
  Delete,
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
import { idParam } from '../common/comunes.js';
import { ApiBodyZod } from '../common/zod.js';
import { Modulo, Rol } from '../generated/prisma/client.js';
import {
  actualizarPagoSchema,
  actualizarPrestacionSchema,
  crearPagoSchema,
  facturarSchema,
  listarPrestacionesSchema,
  mesSchema,
  pagoLoteSchema,
  type ActualizarPagoDto,
  type ActualizarPrestacionDto,
  type CrearPagoDto,
  type ListarPrestacionesDto,
  type PagoLoteDto,
} from './cobros.schemas.js';
import { CobrosService } from './cobros.service.js';
import {
  LiquidacionesController,
  LiquidacionesService,
} from './liquidaciones.js';
import { OrdenesController, OrdenesService } from './ordenes.js';
import { PreciosController, PreciosService } from './precios.js';
import { PrestacionesService } from './prestaciones.service.js';

/**
 * Sesiones asistidas (prestaciones) con su cobertura, monto, orden, token y
 * pagos. Las ven admin y recepción (todas) y cada profesional (las suyas); las
 * gestionan admin y recepción.
 */
@ApiTags('cobros')
@ApiBearerAuth()
@RequiereModulo(Modulo.cobros)
@Controller('prestaciones')
export class PrestacionesController {
  constructor(private readonly prestaciones: PrestacionesService) {}

  @Get()
  @Roles(Rol.admin, Rol.recepcion, Rol.profesional)
  listar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: listarPrestacionesSchema }) q: ListarPrestacionesDto,
  ) {
    return this.prestaciones.listar(centroId, quien, q);
  }

  /** Crea las prestaciones que faltan en el mes (turnos presentes sin prestación). */
  @Post('generar')
  @HttpCode(HttpStatus.OK)
  @Roles(Rol.admin, Rol.recepcion)
  @ApiBodyZod(mesSchema)
  generar(
    @CentroActual() centroId: string,
    @Body({ schema: mesSchema }) dto: z.infer<typeof mesSchema>,
  ) {
    return this.prestaciones.generarFaltantes(centroId, dto.mes);
  }

  /** Marca varias sesiones como presentadas a la obra social o facturadas. */
  @Post('facturar')
  @HttpCode(HttpStatus.OK)
  @Roles(Rol.admin, Rol.recepcion)
  @ApiBodyZod(facturarSchema)
  facturar(
    @CentroActual() centroId: string,
    @Body({ schema: facturarSchema }) dto: z.infer<typeof facturarSchema>,
  ) {
    return this.prestaciones.facturar(centroId, dto.ids, dto.facturada);
  }

  @Patch(':id')
  @Roles(Rol.admin, Rol.recepcion)
  @ApiBodyZod(actualizarPrestacionSchema)
  actualizar(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: actualizarPrestacionSchema }) dto: ActualizarPrestacionDto,
  ) {
    return this.prestaciones.actualizar(centroId, id, dto);
  }

  /** Registra un pago (por defecto, el saldo, hoy y cobrado). Devuelve la prestación. */
  @Post(':id/pagos')
  @Roles(Rol.admin, Rol.recepcion)
  @ApiBodyZod(crearPagoSchema)
  pagar(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: crearPagoSchema }) dto: CrearPagoDto,
  ) {
    return this.prestaciones.registrarPago(centroId, id, dto);
  }
}

@ApiTags('cobros')
@ApiBearerAuth()
@Roles(Rol.admin, Rol.recepcion)
@RequiereModulo(Modulo.cobros)
@Controller('pagos')
export class PagosController {
  constructor(private readonly prestaciones: PrestacionesService) {}

  /** Cobra el saldo de varias sesiones de una vez. */
  @Post('lote')
  @ApiBodyZod(pagoLoteSchema)
  lote(
    @CentroActual() centroId: string,
    @Body({ schema: pagoLoteSchema }) dto: PagoLoteDto,
  ) {
    return this.prestaciones.pagarLote(centroId, dto);
  }

  @Patch(':id')
  @ApiBodyZod(actualizarPagoSchema)
  actualizar(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: actualizarPagoSchema }) dto: ActualizarPagoDto,
  ) {
    return this.prestaciones.actualizarPago(centroId, id, dto);
  }

  @Delete(':id')
  borrar(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.prestaciones.borrarPago(centroId, id);
  }
}

@ApiTags('cobros')
@ApiBearerAuth()
@Roles(Rol.admin, Rol.recepcion, Rol.profesional)
@RequiereModulo(Modulo.cobros)
@Controller('cobros')
export class CobrosController {
  constructor(private readonly cobros: CobrosService) {}

  /** Facturado, cobrado, por cobrar y a liquidar del mes, con gráficos por medio y por día. */
  @Get('resumen')
  resumen(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: mesSchema }) q: z.infer<typeof mesSchema>,
  ) {
    return this.cobros.resumen(centroId, quien, q.mes);
  }

  /** Asistidas contra facturadas y cobradas, y la lista de diferencias. */
  @Get('conciliacion')
  conciliacion(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: mesSchema }) q: z.infer<typeof mesSchema>,
  ) {
    return this.cobros.conciliacion(centroId, quien, q.mes);
  }
}

@Module({
  controllers: [
    PrestacionesController,
    PagosController,
    CobrosController,
    OrdenesController,
    PreciosController,
    LiquidacionesController,
  ],
  providers: [
    PrestacionesService,
    LiquidacionesService,
    CobrosService,
    OrdenesService,
    PreciosService,
  ],
  exports: [PrestacionesService],
})
export class CobrosModule {}

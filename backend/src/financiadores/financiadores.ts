import {
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CentroActual, Roles } from '../auth/decoradores.js';
import {
  boolQuery,
  idParam,
  textoObligatorio,
  textoOpcional,
} from '../common/comunes.js';
import { ApiBodyZod } from '../common/zod.js';
import {
  Modulo,
  Prisma,
  Rol,
  TipoFinanciador,
} from '../generated/prisma/client.js';
import { RequiereModulo } from '../planes/planes.js';
import { sinCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ───────── Schemas ─────────

const reglas = {
  codigoPrestacion: textoOpcional(40),
  requiereOrden: z.boolean().optional(),
  requiereToken: z.boolean().optional(),
  maxSesionesSemana: z.number().int().min(1).max(14).nullable().optional(),
  diasValidezOrden: z.number().int().min(1).max(365).nullable().optional(),
  observaciones: textoOpcional(500),
};

export const crearFinanciadorSchema = z.object({
  nombre: textoObligatorio(120),
  tipo: z.enum(TipoFinanciador),
  ...reglas,
});
export type CrearFinanciadorDto = z.infer<typeof crearFinanciadorSchema>;

export const actualizarFinanciadorSchema = crearFinanciadorSchema
  .partial()
  .extend({ activo: z.boolean().optional() })
  .refine((d) => Object.keys(d).length > 0, 'sin cambios');
export type ActualizarFinanciadorDto = z.infer<
  typeof actualizarFinanciadorSchema
>;

const listarSchema = z.object({ incluirInactivos: boolQuery.optional() });

export const SELECT_FINANCIADOR = {
  id: true,
  nombre: true,
  tipo: true,
  activo: true,
  codigoPrestacion: true,
  requiereOrden: true,
  requiereToken: true,
  maxSesionesSemana: true,
  diasValidezOrden: true,
  observaciones: true,
} satisfies Prisma.FinanciadorSelect;

// ───────── Servicio ─────────

@Injectable()
export class FinanciadoresService {
  constructor(private readonly prisma: PrismaService) {}

  listar(centroId: string, incluirInactivos = false) {
    return this.prisma.paraCentro(centroId).financiador.findMany({
      where: incluirInactivos ? {} : { activo: true },
      select: SELECT_FINANCIADOR,
      orderBy: { nombre: 'asc' },
    });
  }

  crear(centroId: string, dto: CrearFinanciadorDto) {
    return this.prisma.paraCentro(centroId).financiador.create({
      data: sinCentro<Prisma.FinanciadorUncheckedCreateInput>(dto),
      select: SELECT_FINANCIADOR,
    });
  }

  actualizar(centroId: string, id: string, dto: ActualizarFinanciadorDto) {
    return this.prisma.paraCentro(centroId).financiador.update({
      where: { id },
      data: dto,
      select: SELECT_FINANCIADOR,
    });
  }
}

// ───────── Controller ─────────

/**
 * Obras sociales, prepagas y CUD del centro, con sus reglas (código de
 * prestación, orden, token, máximo semanal y validez de la orden). Las ven todos
 * los roles; las administra el admin. La baja es activo = false.
 */
@ApiTags('financiadores')
@ApiBearerAuth()
@Controller('financiadores')
export class FinanciadoresController {
  constructor(private readonly financiadores: FinanciadoresService) {}

  @Get()
  @Roles(Rol.admin, Rol.recepcion, Rol.profesional)
  listar(
    @CentroActual() centroId: string,
    @Query({ schema: listarSchema }) q: z.infer<typeof listarSchema>,
  ) {
    return this.financiadores.listar(centroId, q.incluirInactivos);
  }

  @Post()
  @Roles(Rol.admin)
  @RequiereModulo(Modulo.obras_sociales)
  @ApiBodyZod(crearFinanciadorSchema)
  crear(
    @CentroActual() centroId: string,
    @Body({ schema: crearFinanciadorSchema }) dto: CrearFinanciadorDto,
  ) {
    return this.financiadores.crear(centroId, dto);
  }

  @Patch(':id')
  @Roles(Rol.admin)
  @RequiereModulo(Modulo.obras_sociales)
  @ApiBodyZod(actualizarFinanciadorSchema)
  actualizar(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: actualizarFinanciadorSchema })
    dto: ActualizarFinanciadorDto,
  ) {
    return this.financiadores.actualizar(centroId, id, dto);
  }
}

@Module({
  controllers: [FinanciadoresController],
  providers: [FinanciadoresService],
})
export class FinanciadoresModule {}

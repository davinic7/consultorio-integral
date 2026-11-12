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
import { Modulo, Prisma, Rol } from '../generated/prisma/client.js';
import { LimitesPlan, RequiereModulo } from '../planes/planes.js';
import { sinCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ───────── Schemas ─────────

export const crearSalaSchema = z.object({
  nombre: textoObligatorio(80),
  descripcion: textoOpcional(255),
});
export type CrearSalaDto = z.infer<typeof crearSalaSchema>;

export const actualizarSalaSchema = crearSalaSchema
  .partial()
  .extend({ activa: z.boolean().optional() })
  .refine((d) => Object.keys(d).length > 0, 'sin cambios');
export type ActualizarSalaDto = z.infer<typeof actualizarSalaSchema>;

const listarSalasSchema = z.object({ incluirInactivas: boolQuery.optional() });

const SELECT_SALA = {
  id: true,
  nombre: true,
  descripcion: true,
  activa: true,
} satisfies Prisma.SalaSelect;

// ───────── Servicio ─────────

@Injectable()
export class SalasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: LimitesPlan,
  ) {}

  listar(centroId: string, incluirInactivas = false) {
    return this.prisma.paraCentro(centroId).sala.findMany({
      where: incluirInactivas ? {} : { activa: true },
      select: SELECT_SALA,
      orderBy: { nombre: 'asc' },
    });
  }

  async crear(centroId: string, dto: CrearSalaDto) {
    await this.limites.exigirLugar(centroId, 'salas');
    return this.prisma.paraCentro(centroId).sala.create({
      data: sinCentro<Prisma.SalaUncheckedCreateInput>(dto),
      select: SELECT_SALA,
    });
  }

  async actualizar(centroId: string, id: string, dto: ActualizarSalaDto) {
    if (dto.activa === true) {
      const actual = await this.prisma
        .paraCentro(centroId)
        .sala.findUnique({ where: { id }, select: { activa: true } });
      if (actual && !actual.activa)
        await this.limites.exigirLugar(centroId, 'salas');
    }
    return this.prisma.paraCentro(centroId).sala.update({
      where: { id },
      data: dto,
      select: SELECT_SALA,
    });
  }
}

// ───────── Controller ─────────

/**
 * Salas del centro: las ven todos; las administra el admin (si el plan incluye
 * salas). La baja es activa = false.
 */
@ApiTags('salas')
@ApiBearerAuth()
@Controller('salas')
export class SalasController {
  constructor(private readonly salas: SalasService) {}

  @Get()
  @Roles(Rol.admin, Rol.recepcion, Rol.profesional)
  listar(
    @CentroActual() centroId: string,
    @Query({ schema: listarSalasSchema }) q: z.infer<typeof listarSalasSchema>,
  ) {
    return this.salas.listar(centroId, q.incluirInactivas);
  }

  @Post()
  @Roles(Rol.admin)
  @RequiereModulo(Modulo.salas)
  @ApiBodyZod(crearSalaSchema)
  crear(
    @CentroActual() centroId: string,
    @Body({ schema: crearSalaSchema }) dto: CrearSalaDto,
  ) {
    return this.salas.crear(centroId, dto);
  }

  @Patch(':id')
  @Roles(Rol.admin)
  @RequiereModulo(Modulo.salas)
  @ApiBodyZod(actualizarSalaSchema)
  actualizar(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: actualizarSalaSchema }) dto: ActualizarSalaDto,
  ) {
    return this.salas.actualizar(centroId, id, dto);
  }
}

@Module({
  controllers: [SalasController],
  providers: [SalasService],
  exports: [SalasService],
})
export class SalasModule {}

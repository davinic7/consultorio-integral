import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import {
  boolQuery,
  idParam,
  textoObligatorio,
  textoOpcional,
} from '../common/comunes.js';
import { ApiBodyZod } from '../common/zod.js';
import { Prisma, Rol, type Profesional } from '../generated/prisma/client.js';
import { sinCentro } from '../prisma/centro.js';
import { LimitesPlan } from '../planes/planes.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ───────── Schemas ─────────

const porcentaje = z.number().min(0).max(100).multipleOf(0.01);

export const crearProfesionalSchema = z.object({
  nombre: textoObligatorio(80),
  apellido: textoObligatorio(80),
  disciplina: textoObligatorio(80),
  matricula: textoOpcional(40),
  porcentajeLiquidacion: porcentaje.default(0),
  /** Usuario del centro con el que inicia sesión (opcional). */
  usuarioId: z.uuid().nullable().optional(),
});
export type CrearProfesionalDto = z.infer<typeof crearProfesionalSchema>;

export const actualizarProfesionalSchema = crearProfesionalSchema
  .extend({
    porcentajeLiquidacion: porcentaje.optional(),
    activo: z.boolean().optional(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'sin cambios');
export type ActualizarProfesionalDto = z.infer<
  typeof actualizarProfesionalSchema
>;

const listarSchema = z.object({ incluirInactivos: boolQuery.optional() });

export interface ProfesionalVista {
  id: string;
  nombre: string;
  apellido: string;
  disciplina: string;
  matricula: string | null;
  usuarioId: string | null;
  activo: boolean;
  /** Solo para el admin y para el propio profesional. */
  porcentajeLiquidacion?: number;
}

// ───────── Servicio ─────────

@Injectable()
export class ProfesionalesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly limites: LimitesPlan,
  ) {}

  async listar(
    centroId: string,
    quien: UsuarioAutenticado,
    incluirInactivos = false,
  ) {
    const lista = await this.prisma.paraCentro(centroId).profesional.findMany({
      where: incluirInactivos ? {} : { activo: true },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });
    return lista.map((p) => vista(p, quien));
  }

  async obtener(centroId: string, id: string, quien: UsuarioAutenticado) {
    const p = await this.prisma
      .paraCentro(centroId)
      .profesional.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Profesional no encontrado');
    return vista(p, quien);
  }

  async crear(
    centroId: string,
    dto: CrearProfesionalDto,
    quien: UsuarioAutenticado,
  ) {
    if (dto.usuarioId) await this.validarUsuario(centroId, dto.usuarioId);
    // Nace activo: cuenta para el límite del plan.
    await this.limites.exigirLugar(centroId, 'profesionales');
    const p = await this.prisma.paraCentro(centroId).profesional.create({
      data: sinCentro<Prisma.ProfesionalUncheckedCreateInput>(dto),
    });
    return vista(p, quien);
  }

  async actualizar(
    centroId: string,
    id: string,
    dto: ActualizarProfesionalDto,
    quien: UsuarioAutenticado,
  ) {
    if (dto.usuarioId) await this.validarUsuario(centroId, dto.usuarioId);
    if (dto.activo === true) {
      const actual = await this.prisma
        .paraCentro(centroId)
        .profesional.findUnique({ where: { id }, select: { activo: true } });
      if (actual && !actual.activo)
        await this.limites.exigirLugar(centroId, 'profesionales');
    }
    const p = await this.prisma.paraCentro(centroId).profesional.update({
      where: { id },
      data: dto,
    });
    return vista(p, quien);
  }

  /**
   * El usuario a vincular tiene que ser miembro activo del centro con rol profesional
   * o administración (un profesional que trabaja solo administra su propio espacio).
   */
  private async validarUsuario(centroId: string, usuarioId: string) {
    const miembro = await this.prisma
      .paraCentro(centroId)
      .miembro.findFirst({ where: { usuarioId, activo: true } });
    if (!miembro)
      throw new BadRequestException(
        'usuarioId: no es miembro activo de este centro',
      );
    if (miembro.rol !== Rol.profesional && miembro.rol !== Rol.admin) {
      throw new BadRequestException(
        'usuarioId: el usuario tiene que tener rol profesional o administración',
      );
    }
  }
}

function vista(p: Profesional, quien: UsuarioAutenticado): ProfesionalVista {
  const v: ProfesionalVista = {
    id: p.id,
    nombre: p.nombre,
    apellido: p.apellido,
    disciplina: p.disciplina,
    matricula: p.matricula,
    usuarioId: p.usuarioId,
    activo: p.activo,
  };
  if (quien.rol === Rol.admin || p.usuarioId === quien.usuarioId) {
    v.porcentajeLiquidacion = p.porcentajeLiquidacion.toNumber();
  }
  return v;
}

// ───────── Controller ─────────

@ApiTags('profesionales')
@ApiBearerAuth()
@Controller('profesionales')
export class ProfesionalesController {
  constructor(private readonly profesionales: ProfesionalesService) {}

  @Get()
  @Roles(Rol.admin, Rol.recepcion, Rol.profesional)
  listar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: listarSchema }) q: z.infer<typeof listarSchema>,
  ) {
    return this.profesionales.listar(centroId, quien, q.incluirInactivos);
  }

  @Get(':id')
  @Roles(Rol.admin, Rol.recepcion, Rol.profesional)
  obtener(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.profesionales.obtener(centroId, id, quien);
  }

  @Post()
  @Roles(Rol.admin)
  @ApiBodyZod(crearProfesionalSchema)
  crear(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Body({ schema: crearProfesionalSchema }) dto: CrearProfesionalDto,
  ) {
    return this.profesionales.crear(centroId, dto, quien);
  }

  @Patch(':id')
  @Roles(Rol.admin)
  @ApiBodyZod(actualizarProfesionalSchema)
  actualizar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: actualizarProfesionalSchema })
    dto: ActualizarProfesionalDto,
  ) {
    return this.profesionales.actualizar(centroId, id, dto, quien);
  }
}

@Module({
  controllers: [ProfesionalesController],
  providers: [ProfesionalesService],
  exports: [ProfesionalesService],
})
export class ProfesionalesModule {}

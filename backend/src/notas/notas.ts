import { RequiereModulo } from '../planes/planes.js';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { idParam, textoObligatorio } from '../common/comunes.js';
import { ApiBodyZod } from '../common/zod.js';
import { Modulo, Prisma, Rol } from '../generated/prisma/client.js';
import { sinCentro, type ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CifradoService } from './cifrado.js';

// ───────── Schemas ─────────

export const crearNotaSchema = z.object({
  texto: textoObligatorio(20_000),
  /** Compartida con los demás profesionales que atienden al paciente. */
  compartida: z.boolean().default(false),
  /** Turno (sesión) al que corresponde la nota, si hay. */
  turnoId: z.uuid().nullable().optional(),
});
export type CrearNotaDto = z.infer<typeof crearNotaSchema>;

export const editarNotaSchema = z
  .object({ texto: textoObligatorio(20_000), compartida: z.boolean() })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'sin cambios');
export type EditarNotaDto = z.infer<typeof editarNotaSchema>;

const INCLUDE = {
  profesional: {
    select: { id: true, nombre: true, apellido: true, disciplina: true },
  },
  turno: { select: { id: true, inicio: true } },
} satisfies Prisma.NotaSesionInclude;

type NotaCompleta = Prisma.NotaSesionGetPayload<{ include: typeof INCLUDE }>;

// ───────── Servicio ─────────

/**
 * Notas de sesión. Son del profesional que las escribe: privadas por defecto,
 * y si las comparte las ven los demás profesionales que atienden al paciente.
 * Admin y recepción no acceden a notas clínicas. El texto se guarda cifrado.
 */
@Injectable()
export class NotasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cifrado: CifradoService,
  ) {}

  async listar(centroId: string, quien: UsuarioAutenticado, pacienteId: string) {
    const db = this.prisma.paraCentro(centroId);
    const yo = await this.profesionalAsignado(db, quien, pacienteId);
    const notas = await db.notaSesion.findMany({
      where: {
        pacienteId,
        OR: [{ profesionalId: yo }, { compartida: true }],
      },
      include: INCLUDE,
      orderBy: { creadaEn: 'desc' },
    });
    return Promise.all(notas.map((n) => this.vista(n, yo)));
  }

  async crear(
    centroId: string,
    quien: UsuarioAutenticado,
    pacienteId: string,
    dto: CrearNotaDto,
  ) {
    const db = this.prisma.paraCentro(centroId);
    const yo = await this.profesionalAsignado(db, quien, pacienteId);
    if (dto.turnoId) {
      const turno = await db.turno.count({
        where: { id: dto.turnoId, pacienteId, profesionalId: yo },
      });
      if (!turno) {
        throw new BadRequestException(
          'turnoId: no es un turno tuyo con este paciente',
        );
      }
    }
    const texto = await this.cifrado.cifrarNota(dto.texto, {
      centroId,
      pacienteId,
      profesionalId: yo,
    });
    const nota = await db.notaSesion.create({
      data: sinCentro<Prisma.NotaSesionUncheckedCreateInput>({
        pacienteId,
        profesionalId: yo,
        turnoId: dto.turnoId ?? null,
        texto,
        compartida: dto.compartida,
      }),
      include: INCLUDE,
    });
    return this.vista(nota, yo, dto.texto);
  }

  /** Solo el autor edita su nota. */
  async editar(
    centroId: string,
    quien: UsuarioAutenticado,
    id: string,
    dto: EditarNotaDto,
  ) {
    const db = this.prisma.paraCentro(centroId);
    const actual = await db.notaSesion.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('Nota no encontrada');
    const yo = await this.profesionalAsignado(db, quien, actual.pacienteId);
    if (actual.profesionalId !== yo) {
      // No se revela si existe una nota privada ajena.
      if (!actual.compartida) throw new NotFoundException('Nota no encontrada');
      throw new ForbiddenException('Solo quien escribió la nota puede editarla');
    }
    const data: Prisma.NotaSesionUncheckedUpdateInput = {};
    if (dto.compartida !== undefined) data.compartida = dto.compartida;
    if (dto.texto !== undefined) {
      data.texto = await this.cifrado.cifrarNota(dto.texto, {
        centroId,
        pacienteId: actual.pacienteId,
        profesionalId: yo,
      });
    }
    const nota = await db.notaSesion.update({
      where: { id },
      data,
      include: INCLUDE,
    });
    return this.vista(nota, yo, dto.texto);
  }

  /**
   * Ficha de profesional de quien pide, que tiene que atender al paciente.
   * Si no lo atiende, el paciente "no existe" para él.
   */
  private async profesionalAsignado(
    db: ClienteDeCentro,
    quien: UsuarioAutenticado,
    pacienteId: string,
  ): Promise<string> {
    const yo = await db.profesional.findFirst({
      where: { usuarioId: quien.usuarioId, activo: true },
      select: { id: true },
    });
    if (!yo) {
      throw new ForbiddenException(
        'Tu cuenta no está vinculada a un profesional del centro',
      );
    }
    const asignado = await db.pacienteProfesional.count({
      where: { pacienteId, profesionalId: yo.id },
    });
    if (!asignado) throw new NotFoundException('Paciente no encontrado');
    return yo.id;
  }

  private async vista(n: NotaCompleta, yo: string, textoEnClaro?: string) {
    return {
      id: n.id,
      texto:
        textoEnClaro ??
        (await this.cifrado.descifrarNota(n.texto, {
          centroId: n.centroId,
          pacienteId: n.pacienteId,
          profesionalId: n.profesionalId,
        })),
      compartida: n.compartida,
      propia: n.profesionalId === yo,
      profesional: n.profesional,
      turno: n.turno
        ? { id: n.turno.id, inicio: n.turno.inicio.toISOString() }
        : null,
      creadaEn: n.creadaEn.toISOString(),
      actualizadaEn: n.actualizadaEn.toISOString(),
    };
  }
}

// ───────── Controllers ─────────

@ApiTags('notas')
@ApiBearerAuth()
// Admin también: un profesional que trabaja solo es admin de su espacio. Igual hace falta
// una ficha de profesional vinculada y que atienda al paciente (profesionalAsignado).
@Roles(Rol.profesional, Rol.admin)
@RequiereModulo(Modulo.notas)
@Controller('pacientes')
export class NotasDePacienteController {
  constructor(private readonly notas: NotasService) {}

  /** Mis notas del paciente y las que compartieron los demás profesionales. */
  @Get(':id/notas')
  listar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.notas.listar(centroId, quien, id);
  }

  @Post(':id/notas')
  @ApiBodyZod(crearNotaSchema)
  crear(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: crearNotaSchema }) dto: CrearNotaDto,
  ) {
    return this.notas.crear(centroId, quien, id, dto);
  }
}

@ApiTags('notas')
@ApiBearerAuth()
// Admin también: un profesional que trabaja solo es admin de su espacio. Igual hace falta
// una ficha de profesional vinculada y que atienda al paciente (profesionalAsignado).
@Roles(Rol.profesional, Rol.admin)
@RequiereModulo(Modulo.notas)
@Controller('notas')
export class NotasController {
  constructor(private readonly notas: NotasService) {}

  @Patch(':id')
  @ApiBodyZod(editarNotaSchema)
  editar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: editarNotaSchema }) dto: EditarNotaDto,
  ) {
    return this.notas.editar(centroId, quien, id, dto);
  }
}

@Module({
  controllers: [NotasDePacienteController, NotasController],
  providers: [NotasService, CifradoService],
})
export class NotasModule {}

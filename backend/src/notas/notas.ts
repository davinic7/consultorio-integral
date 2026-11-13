import { RequiereModulo } from '../planes/planes.js';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { idParam, textoObligatorio } from '../common/comunes.js';
import { aLocal, rangoDeFechas, sumarDias } from '../common/tiempo.js';
import { ApiBodyZod } from '../common/zod.js';
import {
  EstadoAsistencia,
  Modulo,
  OrigenNota,
  Prisma,
  Rol,
} from '../generated/prisma/client.js';
import { sinCentro, type ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { BorradoresVencidos, limiteBorradores } from './borradores-vencidos.js';
import { CifradoService } from './cifrado.js';

// ───────── Schemas ─────────

export const crearNotaSchema = z.object({
  texto: textoObligatorio(20_000),
  /** Compartida con los demás profesionales que atienden al paciente. */
  compartida: z.boolean().default(false),
  /** Turno (sesión) al que corresponde la nota, si hay. */
  turnoId: z.uuid().nullable().optional(),
  /** Escrita con el teclado o dictada (transcripta y revisada por el profesional). */
  origen: z.enum(OrigenNota).default(OrigenNota.escrita),
});
export type CrearNotaDto = z.infer<typeof crearNotaSchema>;

export const editarNotaSchema = z
  .object({ texto: textoObligatorio(20_000), compartida: z.boolean() })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'sin cambios');
export type EditarNotaDto = z.infer<typeof editarNotaSchema>;

/** El borrador se guarda solo mientras se escribe: puede estar vacío. */
export const guardarBorradorSchema = z.object({
  texto: z.string().max(20_000),
  compartida: z.boolean().default(false),
  turnoId: z.uuid().nullable().optional(),
  origen: z.enum(OrigenNota).default(OrigenNota.escrita),
});
export type GuardarBorradorDto = z.infer<typeof guardarBorradorSchema>;

/** Días hacia atrás que se ofrecen para vincular una evolución con su sesión. */
const DIAS_SESIONES = 60;

const INCLUDE = {
  profesional: {
    select: { id: true, nombre: true, apellido: true, disciplina: true },
  },
  turno: {
    select: { id: true, inicio: true, sala: { select: { nombre: true } } },
  },
} satisfies Prisma.NotaSesionInclude;

type NotaCompleta = Prisma.NotaSesionGetPayload<{ include: typeof INCLUDE }>;

/** Contexto del cifrado del borrador: distinto al de las notas, no se puede pasar de uno a otro. */
const contextoBorrador = (pacienteId: string, profesionalId: string) =>
  `borrador-nota:${pacienteId}:${profesionalId}`;

/**
 * Ficha de profesional de quien pide, que tiene que atender al paciente.
 * Si no lo atiende, el paciente "no existe" para él. La usan las notas y el dictado.
 */
export async function profesionalAsignado(
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

/** Suma un tramo al final del borrador, separado por un renglón libre. */
export function sumarAlFinal(borrador: string, nuevo: string): string {
  const a = borrador.trimEnd();
  const b = nuevo.trim();
  if (!b) return borrador;
  return a ? `${a}\n\n${b}` : b;
}

/** El turno tiene que ser mío y con este paciente. */
export async function validarTurno(
  db: ClienteDeCentro,
  turnoId: string | null | undefined,
  pacienteId: string,
  profesionalId: string,
): Promise<void> {
  if (!turnoId) return;
  const turno = await db.turno.count({
    where: { id: turnoId, pacienteId, profesionalId },
  });
  if (!turno) {
    throw new BadRequestException(
      'turnoId: no es un turno tuyo con este paciente',
    );
  }
}

// ───────── Servicio ─────────

/**
 * Notas de sesión (las evoluciones del expediente). Son del profesional que las
 * escribe: privadas por defecto, y si las comparte las ven los demás profesionales
 * que atienden al paciente. Admin y recepción no acceden a notas clínicas. El texto
 * se guarda cifrado.
 */
@Injectable()
export class NotasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cifrado: CifradoService,
  ) {}

  async listar(
    centroId: string,
    quien: UsuarioAutenticado,
    pacienteId: string,
  ) {
    const db = this.prisma.paraCentro(centroId);
    const yo = await profesionalAsignado(db, quien, pacienteId);
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

  /**
   * Mis sesiones con el paciente, para elegir a cuál corresponde una evolución:
   * de los últimos días hasta el final de hoy, de la más nueva a la más vieja.
   */
  async sesiones(
    centroId: string,
    quien: UsuarioAutenticado,
    pacienteId: string,
  ) {
    const db = this.prisma.paraCentro(centroId);
    const yo = await profesionalAsignado(db, quien, pacienteId);
    const centro = await this.prisma.centro.findUniqueOrThrow({
      where: { id: centroId },
      select: { zonaHoraria: true },
    });
    const zona = centro.zonaHoraria;
    const hoy = aLocal(new Date(), zona).fecha;
    const rango = rangoDeFechas(sumarDias(hoy, -DIAS_SESIONES), hoy, zona);
    const turnos = await db.turno.findMany({
      where: {
        pacienteId,
        profesionalId: yo,
        inicio: { gte: rango.desde, lt: rango.hasta },
        estadoAsistencia: { not: EstadoAsistencia.cancelado_profesional },
      },
      select: {
        id: true,
        inicio: true,
        estadoAsistencia: true,
        sala: { select: { id: true, nombre: true } },
        _count: { select: { notasSesion: { where: { profesionalId: yo } } } },
      },
      orderBy: { inicio: 'desc' },
    });
    return {
      hoy,
      turnos: turnos.map((t) => ({
        id: t.id,
        ...aLocal(t.inicio, zona),
        inicio: t.inicio.toISOString(),
        estadoAsistencia: t.estadoAsistencia,
        sala: t.sala,
        conNota: t._count.notasSesion > 0,
      })),
    };
  }

  /** Guarda la evolución. Si había un borrador mío de este paciente, se borra. */
  async crear(
    centroId: string,
    quien: UsuarioAutenticado,
    pacienteId: string,
    dto: CrearNotaDto,
  ) {
    const db = this.prisma.paraCentro(centroId);
    const yo = await profesionalAsignado(db, quien, pacienteId);
    await validarTurno(db, dto.turnoId, pacienteId, yo);
    const texto = await this.cifrado.cifrarNota(dto.texto, {
      centroId,
      pacienteId,
      profesionalId: yo,
    });
    const [nota] = await db.$transaction([
      db.notaSesion.create({
        data: sinCentro<Prisma.NotaSesionUncheckedCreateInput>({
          pacienteId,
          profesionalId: yo,
          turnoId: dto.turnoId ?? null,
          texto,
          compartida: dto.compartida,
          origen: dto.origen,
        }),
        include: INCLUDE,
      }),
      db.borradorNota.deleteMany({
        where: { pacienteId, profesionalId: yo },
      }),
    ]);
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
    const yo = await profesionalAsignado(db, quien, actual.pacienteId);
    if (actual.profesionalId !== yo) {
      // No se revela si existe una nota privada ajena.
      if (!actual.compartida) throw new NotFoundException('Nota no encontrada');
      throw new ForbiddenException(
        'Solo quien escribió la nota puede editarla',
      );
    }
    const data: Prisma.NotaSesionUncheckedUpdateInput = {};
    if (dto.compartida !== undefined) data.compartida = dto.compartida;
    if (dto.texto !== undefined) {
      data.texto = await this.cifrado.cifrarNota(dto.texto, {
        centroId,
        pacienteId: actual.pacienteId,
        profesionalId: yo,
      });
      data.editadaEn = new Date();
    }
    const nota = await db.notaSesion.update({
      where: { id },
      data,
      include: INCLUDE,
    });
    return this.vista(nota, yo, dto.texto);
  }

  // ───────── Borrador ─────────

  /**
   * Mi borrador de este paciente, o null. Nadie más lo ve. Si nadie lo tocó en
   * 30 días, venció: se borra y no se devuelve.
   */
  async borrador(
    centroId: string,
    quien: UsuarioAutenticado,
    pacienteId: string,
  ) {
    const db = this.prisma.paraCentro(centroId);
    const yo = await profesionalAsignado(db, quien, pacienteId);
    const b = await db.borradorNota.findUnique({
      where: {
        centroId_pacienteId_profesionalId: {
          centroId,
          pacienteId,
          profesionalId: yo,
        },
      },
    });
    if (!b) return { borrador: null };
    if (b.actualizadoEn < limiteBorradores()) {
      await db.borradorNota.deleteMany({ where: { id: b.id } });
      return { borrador: null };
    }
    const texto = await this.cifrado.descifrarDato(
      centroId,
      b.texto,
      contextoBorrador(pacienteId, yo),
    );
    return {
      borrador: {
        texto: texto ?? '',
        compartida: b.compartida,
        origen: b.origen,
        turnoId: b.turnoId,
        actualizadoEn: b.actualizadoEn.toISOString(),
      },
    };
  }

  /** Guarda (o reemplaza) mi borrador de este paciente mientras escribo. */
  async guardarBorrador(
    centroId: string,
    quien: UsuarioAutenticado,
    pacienteId: string,
    dto: GuardarBorradorDto,
  ) {
    const db = this.prisma.paraCentro(centroId);
    const yo = await profesionalAsignado(db, quien, pacienteId);
    await validarTurno(db, dto.turnoId, pacienteId, yo);
    const texto = await this.cifrado.cifrarDato(
      centroId,
      dto.texto,
      contextoBorrador(pacienteId, yo),
    );
    const datos = {
      texto,
      compartida: dto.compartida,
      origen: dto.origen,
      turnoId: dto.turnoId ?? null,
    };
    const b = await db.borradorNota.upsert({
      where: {
        centroId_pacienteId_profesionalId: {
          centroId,
          pacienteId,
          profesionalId: yo,
        },
      },
      create: sinCentro<Prisma.BorradorNotaUncheckedCreateInput>({
        pacienteId,
        profesionalId: yo,
        ...datos,
      }),
      update: datos,
    });
    return {
      borrador: {
        texto: dto.texto,
        compartida: b.compartida,
        origen: b.origen,
        turnoId: b.turnoId,
        actualizadoEn: b.actualizadoEn.toISOString(),
      },
    };
  }

  /**
   * Suma texto dictado al final del borrador del profesional para este paciente
   * (lo crea si no hay) y lo marca como dictado. Lo usa el dictado al terminar de
   * transcribir: el texto va directo al servidor, nunca queda en el teléfono.
   */
  async sumarAlBorrador(
    centroId: string,
    profesionalId: string,
    pacienteId: string,
    texto: string,
    turnoId: string | null,
  ): Promise<void> {
    const db = this.prisma.paraCentro(centroId);
    const contexto = contextoBorrador(pacienteId, profesionalId);
    const actual = await db.borradorNota.findUnique({
      where: {
        centroId_pacienteId_profesionalId: {
          centroId,
          pacienteId,
          profesionalId,
        },
      },
    });
    const previo = actual
      ? ((await this.cifrado.descifrarDato(centroId, actual.texto, contexto)) ??
        '')
      : '';
    const cifrado = await this.cifrado.cifrarDato(
      centroId,
      sumarAlFinal(previo, texto),
      contexto,
    );
    if (actual) {
      await db.borradorNota.update({
        where: { id: actual.id },
        data: { texto: cifrado, origen: OrigenNota.dictada },
      });
    } else {
      await db.borradorNota.create({
        data: sinCentro<Prisma.BorradorNotaUncheckedCreateInput>({
          pacienteId,
          profesionalId,
          turnoId,
          texto: cifrado,
          origen: OrigenNota.dictada,
        }),
      });
    }
  }

  async descartarBorrador(
    centroId: string,
    quien: UsuarioAutenticado,
    pacienteId: string,
  ): Promise<void> {
    const db = this.prisma.paraCentro(centroId);
    const yo = await profesionalAsignado(db, quien, pacienteId);
    await db.borradorNota.deleteMany({
      where: { pacienteId, profesionalId: yo },
    });
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
      origen: n.origen,
      propia: n.profesionalId === yo,
      profesional: n.profesional,
      turno: n.turno
        ? {
            id: n.turno.id,
            inicio: n.turno.inicio.toISOString(),
            sala: n.turno.sala?.nombre ?? null,
          }
        : null,
      creadaEn: n.creadaEn.toISOString(),
      actualizadaEn: n.actualizadaEn.toISOString(),
      editadaEn: n.editadaEn?.toISOString() ?? null,
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

  /** Mis sesiones recientes con el paciente, para vincular una evolución. */
  @Get(':id/notas/sesiones')
  sesiones(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.notas.sesiones(centroId, quien, id);
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

  /** Mi borrador de este paciente (`borrador: null` si no hay). */
  @Get(':id/notas/borrador')
  borrador(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.notas.borrador(centroId, quien, id);
  }

  @Put(':id/notas/borrador')
  @ApiBodyZod(guardarBorradorSchema)
  guardarBorrador(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: guardarBorradorSchema }) dto: GuardarBorradorDto,
  ) {
    return this.notas.guardarBorrador(centroId, quien, id, dto);
  }

  @Delete(':id/notas/borrador')
  @HttpCode(204)
  descartarBorrador(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.notas.descartarBorrador(centroId, quien, id);
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
  providers: [NotasService, CifradoService, BorradoresVencidos],
  exports: [CifradoService, NotasService],
})
export class NotasModule {}

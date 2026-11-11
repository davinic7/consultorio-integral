import { RequiereModulo } from '../planes/planes.js';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
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
import { aFechaSolo, idParam } from '../common/comunes.js';
import { aLocal } from '../common/tiempo.js';
import { ApiBodyZod } from '../common/zod.js';
import { Modulo, Prisma, Rol } from '../generated/prisma/client.js';
import { sinCentro, type ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  actualizarOrdenSchema,
  crearOrdenSchema,
  listarOrdenesSchema,
  type ActualizarOrdenDto,
  type CrearOrdenDto,
} from './cobros.schemas.js';
import { alcanceDe } from './comun.js';
import { vencimientoDeOrden } from './reglas.js';

const dia = (fecha: string) => new Date(`${fecha}T00:00:00Z`);

const INCLUDE = {
  financiador: { select: { id: true, nombre: true } },
  prestaciones: { select: { fecha: true }, orderBy: { fecha: 'asc' } },
} satisfies Prisma.OrdenInclude;

type OrdenCompleta = Prisma.OrdenGetPayload<{ include: typeof INCLUDE }>;

function vista(o: OrdenCompleta, hoy: string) {
  const emision = aFechaSolo(o.fechaEmision)!;
  const vence = aFechaSolo(o.vence);
  const usadas = o.prestaciones.length;
  return {
    id: o.id,
    pacienteId: o.pacienteId,
    financiador: o.financiador,
    numero: o.numero,
    fechaEmision: emision,
    vence,
    sesiones: o.sesiones,
    usadas,
    disponibles: Math.max(o.sesiones - usadas, 0),
    /** Fechas de las sesiones que cubre. */
    fechasUsadas: o.prestaciones.map((p) => aFechaSolo(p.fecha)!),
    vigente: emision <= hoy && (vence === null || vence >= hoy),
    observaciones: o.observaciones,
  };
}

/**
 * Órdenes de autorización de las obras sociales que las piden. Cada sesión
 * presente toma una orden vigente con lugar; al cargar una orden nueva se asigna
 * a las sesiones que estaban esperando.
 */
@Injectable()
export class OrdenesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(
    centroId: string,
    quien: UsuarioAutenticado,
    pacienteId: string,
  ) {
    const db = this.db(centroId);
    await this.exigirPaciente(db, quien, pacienteId);
    const ordenes = await db.orden.findMany({
      where: { pacienteId },
      include: INCLUDE,
      orderBy: [{ fechaEmision: 'desc' }, { creadaEn: 'desc' }],
    });
    const hoy = await this.hoy(centroId);
    return ordenes.map((o) => vista(o, hoy));
  }

  async crear(centroId: string, dto: CrearOrdenDto) {
    const db = this.db(centroId);
    const [paciente, financiador] = await Promise.all([
      db.paciente.findUnique({
        where: { id: dto.pacienteId },
        select: { id: true },
      }),
      db.financiador.findUnique({
        where: { id: dto.financiadorId },
        select: { diasValidezOrden: true },
      }),
    ]);
    if (!paciente) throw new NotFoundException('Paciente no encontrado');
    if (!financiador) throw new NotFoundException('Obra social no encontrada');
    const vence =
      dto.vence !== undefined
        ? dto.vence
        : vencimientoDeOrden(dto.fechaEmision, financiador.diasValidezOrden);
    this.exigirFechas(dto.fechaEmision, vence);

    const orden = await db.$transaction(async (tx) => {
      const o = await tx.orden.create({
        data: sinCentro<Prisma.OrdenUncheckedCreateInput>({
          pacienteId: dto.pacienteId,
          financiadorId: dto.financiadorId,
          numero: dto.numero,
          fechaEmision: dia(dto.fechaEmision),
          vence: vence ? dia(vence) : null,
          sesiones: dto.sesiones,
          observaciones: dto.observaciones ?? null,
        }),
      });
      // Sesiones del paciente con esta obra social que esperaban orden.
      const esperando = await tx.prestacion.findMany({
        where: {
          pacienteId: dto.pacienteId,
          financiadorId: dto.financiadorId,
          ordenId: null,
          fecha: { gte: o.fechaEmision, ...(o.vence ? { lte: o.vence } : {}) },
        },
        select: { id: true },
        orderBy: { fecha: 'asc' },
        take: dto.sesiones,
      });
      if (esperando.length) {
        await tx.prestacion.updateMany({
          where: { id: { in: esperando.map((p) => p.id) } },
          data: { ordenId: o.id },
        });
      }
      return tx.orden.findUniqueOrThrow({
        where: { id: o.id },
        include: INCLUDE,
      });
    });
    return vista(orden, await this.hoy(centroId));
  }

  async actualizar(centroId: string, id: string, dto: ActualizarOrdenDto) {
    const db = this.db(centroId);
    const actual = await db.orden.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!actual) throw new NotFoundException('Orden no encontrada');
    const emision = dto.fechaEmision ?? aFechaSolo(actual.fechaEmision)!;
    const vence =
      dto.vence !== undefined ? dto.vence : aFechaSolo(actual.vence);
    this.exigirFechas(emision, vence);
    if (
      dto.sesiones !== undefined &&
      dto.sesiones < actual.prestaciones.length
    ) {
      throw new ConflictException(
        `La orden ya cubre ${actual.prestaciones.length} sesiones`,
      );
    }
    const orden = await db.orden.update({
      where: { id },
      data: {
        ...dto,
        fechaEmision: dia(emision),
        vence: vence ? dia(vence) : null,
      },
      include: INCLUDE,
    });
    return vista(orden, await this.hoy(centroId));
  }

  async borrar(centroId: string, id: string) {
    const db = this.db(centroId);
    const o = await db.orden.findUnique({
      where: { id },
      select: { _count: { select: { prestaciones: true } } },
    });
    if (!o) throw new NotFoundException('Orden no encontrada');
    if (o._count.prestaciones) {
      throw new ConflictException(
        'La orden ya cubre sesiones: quitala de esas sesiones antes de borrarla',
      );
    }
    await db.orden.delete({ where: { id } });
  }

  private exigirFechas(emision: string, vence: string | null): void {
    if (vence && vence < emision) {
      throw new BadRequestException(
        'El vencimiento no puede ser anterior a la emisión',
      );
    }
  }

  /** El profesional solo ve las órdenes de sus pacientes. */
  private async exigirPaciente(
    db: ClienteDeCentro,
    quien: UsuarioAutenticado,
    pacienteId: string,
  ): Promise<void> {
    const alcance = await alcanceDe(db, quien);
    const p = await db.paciente.findFirst({
      where: {
        id: pacienteId,
        ...(alcance.profesionalId
          ? {
              profesionales: { some: { profesionalId: alcance.profesionalId } },
            }
          : {}),
      },
      select: { id: true },
    });
    if (!p) throw new NotFoundException('Paciente no encontrado');
  }

  private async hoy(centroId: string): Promise<string> {
    const c = await this.prisma.centro.findUniqueOrThrow({
      where: { id: centroId },
      select: { zonaHoraria: true },
    });
    return aLocal(new Date(), c.zonaHoraria).fecha;
  }

  private db(centroId: string): ClienteDeCentro {
    return this.prisma.paraCentro(centroId);
  }
}

@ApiTags('ordenes')
@ApiBearerAuth()
@RequiereModulo(Modulo.obras_sociales)
@Controller('ordenes')
export class OrdenesController {
  constructor(private readonly ordenes: OrdenesService) {}

  @Get()
  @Roles(Rol.admin, Rol.recepcion, Rol.profesional)
  listar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: listarOrdenesSchema })
    q: z.infer<typeof listarOrdenesSchema>,
  ) {
    return this.ordenes.listar(centroId, quien, q.pacienteId);
  }

  @Post()
  @Roles(Rol.admin, Rol.recepcion)
  @ApiBodyZod(crearOrdenSchema)
  crear(
    @CentroActual() centroId: string,
    @Body({ schema: crearOrdenSchema }) dto: CrearOrdenDto,
  ) {
    return this.ordenes.crear(centroId, dto);
  }

  @Patch(':id')
  @Roles(Rol.admin, Rol.recepcion)
  @ApiBodyZod(actualizarOrdenSchema)
  actualizar(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: actualizarOrdenSchema }) dto: ActualizarOrdenDto,
  ) {
    return this.ordenes.actualizar(centroId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Rol.admin, Rol.recepcion)
  borrar(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.ordenes.borrar(centroId, id);
  }
}

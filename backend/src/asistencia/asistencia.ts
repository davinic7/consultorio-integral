import { RequiereModulo } from '../planes/planes.js';
import {
  Controller,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { idParam } from '../common/comunes.js';
import {
  aLocal,
  diasEntre,
  fechaTexto,
  rangoDeFechas,
  sumarDias,
} from '../common/tiempo.js';
import { EstadoAsistencia, Modulo, Prisma, Rol } from '../generated/prisma/client.js';
import type { ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ───────── Schemas ─────────

const MAX_DIAS_HISTORIAL = 400;

export const historialSchema = z
  .object({ desde: fechaTexto.optional(), hasta: fechaTexto.optional() })
  .refine(
    (d) =>
      !d.desde ||
      !d.hasta ||
      (diasEntre(d.desde, d.hasta) >= 0 &&
        diasEntre(d.desde, d.hasta) <= MAX_DIAS_HISTORIAL),
    `rango inválido (máximo ${MAX_DIAS_HISTORIAL} días)`,
  );

export const planillaSchema = z.object({
  /** Mes en formato AAAA-MM. */
  mes: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'formato AAAA-MM'),
  profesionalId: z.uuid().optional(),
});

const INCLUDE = {
  profesional: {
    select: { id: true, nombre: true, apellido: true, disciplina: true },
  },
  sala: { select: { id: true, nombre: true } },
} satisfies Prisma.TurnoInclude;

// ───────── Servicio ─────────

/**
 * Historial y planilla mensual de asistencia de un paciente. Admin y recepción
 * ven todos sus turnos; un profesional, solo los suyos con pacientes asignados.
 */
@Injectable()
export class AsistenciaService {
  constructor(private readonly prisma: PrismaService) {}

  async historial(
    centroId: string,
    quien: UsuarioAutenticado,
    pacienteId: string,
    dto: z.infer<typeof historialSchema>,
  ) {
    const { db, zona, filtroProfesional } = await this.contexto(
      centroId,
      quien,
      pacienteId,
    );
    const hoy = aLocal(new Date(), zona).fecha;
    const hasta = dto.hasta ?? sumarDias(hoy, 60);
    const desde = dto.desde ?? sumarDias(hasta, -240);
    const rango = rangoDeFechas(desde, hasta, zona);
    const turnos = await db.turno.findMany({
      where: {
        pacienteId,
        inicio: { gte: rango.desde, lt: rango.hasta },
        ...filtroProfesional,
      },
      include: INCLUDE,
      orderBy: { inicio: 'desc' },
    });

    const resumen = {
      presente: 0,
      ausente_con_aviso: 0,
      ausente_sin_aviso: 0,
      cancelado_profesional: 0,
      pendiente: 0,
    } satisfies Record<EstadoAsistencia, number>;
    for (const t of turnos) resumen[t.estadoAsistencia]++;
    const marcados =
      resumen.presente + resumen.ausente_con_aviso + resumen.ausente_sin_aviso;

    return {
      desde,
      hasta,
      resumen: {
        ...resumen,
        /** Presentes sobre turnos con asistencia marcada (null si no hay). */
        porcentajeAsistencia: marcados
          ? Math.round((resumen.presente * 100) / marcados)
          : null,
      },
      turnos: turnos.map((t) => {
        const ini = aLocal(t.inicio, zona);
        return {
          id: t.id,
          fecha: ini.fecha,
          hora: ini.hora,
          horaFin: aLocal(t.fin, zona).hora,
          estado: t.estadoAsistencia,
          profesional: t.profesional,
          sala: t.sala,
          observaciones: t.observaciones,
        };
      }),
    };
  }

  /**
   * Planilla mensual para imprimir y firmar: las fechas de los turnos del mes
   * (sin los cancelados), con los datos del paciente y su financiador.
   */
  async planilla(
    centroId: string,
    quien: UsuarioAutenticado,
    pacienteId: string,
    dto: z.infer<typeof planillaSchema>,
  ) {
    const { db, zona, filtroProfesional, paciente, centro } =
      await this.contexto(centroId, quien, pacienteId);
    const primerDia = `${dto.mes}-01`;
    const ultimoDia = Temporal.PlainDate.from(primerDia)
      .add({ months: 1 })
      .subtract({ days: 1 })
      .toString();
    const rango = rangoDeFechas(primerDia, ultimoDia, zona);
    const turnos = await db.turno.findMany({
      where: {
        pacienteId,
        inicio: { gte: rango.desde, lt: rango.hasta },
        estadoAsistencia: { not: EstadoAsistencia.cancelado_profesional },
        ...filtroProfesional,
        ...(dto.profesionalId ? { profesionalId: dto.profesionalId } : {}),
      },
      include: INCLUDE,
      orderBy: { inicio: 'asc' },
    });

    const profesionales = new Map(
      turnos.map((t) => [t.profesional.id, t.profesional]),
    );
    return {
      mes: dto.mes,
      centro: centro.nombre,
      paciente: {
        id: paciente.id,
        nombre: paciente.nombre,
        apellido: paciente.apellido,
        dni: paciente.dni,
        financiador: paciente.financiador,
        nroAfiliado: paciente.nroAfiliado,
        tieneCud: paciente.tieneCud,
      },
      profesionales: [...profesionales.values()],
      filas: turnos.map((t) => {
        const ini = aLocal(t.inicio, zona);
        return {
          turnoId: t.id,
          fecha: ini.fecha,
          hora: ini.hora,
          horaFin: aLocal(t.fin, zona).hora,
          profesional: t.profesional,
          estado: t.estadoAsistencia,
        };
      }),
    };
  }

  /** Paciente visible para quien pregunta, zona del centro y alcance de turnos. */
  private async contexto(
    centroId: string,
    quien: UsuarioAutenticado,
    pacienteId: string,
  ) {
    const db: ClienteDeCentro = this.prisma.paraCentro(centroId);
    const centro = await this.prisma.centro.findUniqueOrThrow({
      where: { id: centroId },
      select: { nombre: true, zonaHoraria: true },
    });

    let filtroProfesional: Prisma.TurnoWhereInput = {};
    let alcance: Prisma.PacienteWhereInput = {};
    if (quien.rol === Rol.profesional) {
      const yo = await db.profesional.findFirst({
        where: { usuarioId: quien.usuarioId },
        select: { id: true },
      });
      if (!yo) throw new NotFoundException('Paciente no encontrado');
      filtroProfesional = { profesionalId: yo.id };
      alcance = { profesionales: { some: { profesionalId: yo.id } } };
    }
    const paciente = await db.paciente.findFirst({
      where: { AND: [{ id: pacienteId }, alcance] },
      include: {
        financiador: { select: { id: true, nombre: true, tipo: true } },
      },
    });
    if (!paciente) throw new NotFoundException('Paciente no encontrado');
    return { db, zona: centro.zonaHoraria, filtroProfesional, paciente, centro };
  }
}

// ───────── Controller ─────────

@ApiTags('asistencia')
@ApiBearerAuth()
@Roles(Rol.admin, Rol.recepcion, Rol.profesional)
@RequiereModulo(Modulo.asistencia)
@Controller('pacientes')
export class AsistenciaController {
  constructor(private readonly asistencia: AsistenciaService) {}

  /** Turnos del paciente con su asistencia y un resumen (por defecto, ~8 meses). */
  @Get(':id/asistencia')
  historial(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: historialSchema }) q: z.infer<typeof historialSchema>,
  ) {
    return this.asistencia.historial(centroId, quien, id, q);
  }

  /** Datos de la planilla mensual para imprimir y firmar. */
  @Get(':id/planilla')
  planilla(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Query({ schema: planillaSchema }) q: z.infer<typeof planillaSchema>,
  ) {
    return this.asistencia.planilla(centroId, quien, id, q);
  }
}

@Module({ controllers: [AsistenciaController], providers: [AsistenciaService] })
export class AsistenciaModule {}

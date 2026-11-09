import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { AvisosService } from '../avisos/avisos.js';
import {
  aInstante,
  aLocal,
  fechasSemanales,
  formatoCorto,
  rangoDeFechas,
  sumarDias,
} from '../common/tiempo.js';
import {
  EstadoAsistencia,
  EstadoLiquidacion,
  Prisma,
  Rol,
  TipoAviso,
} from '../generated/prisma/client.js';
import { sinCentro, type ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  SEMANAS_POR_DEFECTO,
  type CancelarTurnoDto,
  type CrearRecurrenciaDto,
  type CrearTurnoDto,
  type ListarTurnosDto,
  type MarcarAsistenciaDto,
  type MoverTurnoDto,
} from './turnos.schemas.js';

const INCLUDE = {
  paciente: { select: { id: true, nombre: true, apellido: true } },
  profesional: { select: { id: true, nombre: true, apellido: true } },
  sala: { select: { id: true, nombre: true } },
} satisfies Prisma.TurnoInclude;

type TurnoCompleto = Prisma.TurnoGetPayload<{ include: typeof INCLUDE }>;

/** Quién hace el pedido, con lo necesario para decidir permisos. */
interface Actor {
  centroId: string;
  usuarioId: string;
  rol: Rol;
  /** Ficha de profesional vinculada a la cuenta (solo para el rol profesional). */
  profesionalId: string | null;
  zona: string;
}

const NO_CANCELADO = {
  estadoAsistencia: { not: EstadoAsistencia.cancelado_profesional },
};

function vista(t: TurnoCompleto, zona: string) {
  const ini = aLocal(t.inicio, zona);
  const fin = aLocal(t.fin, zona);
  return {
    id: t.id,
    fecha: ini.fecha,
    hora: ini.hora,
    horaFin: fin.hora,
    duracionMin: Math.round((t.fin.getTime() - t.inicio.getTime()) / 60_000),
    inicio: t.inicio.toISOString(),
    fin: t.fin.toISOString(),
    estado: t.estadoAsistencia,
    observaciones: t.observaciones,
    recurrenciaId: t.recurrenciaId,
    paciente: t.paciente,
    profesional: t.profesional,
    sala: t.sala,
  };
}
export type TurnoVista = ReturnType<typeof vista>;

const nombre = (p: { nombre: string; apellido: string }) =>
  `${p.nombre} ${p.apellido}`;

/** La base rechazó por superposición (EXCLUDE turnos_*_sin_superposicion). */
function esSuperposicion(e: unknown): boolean {
  const texto = `${(e as Error)?.message ?? ''} ${JSON.stringify((e as { meta?: unknown })?.meta ?? '')}`;
  return texto.includes('sin_superposicion') || texto.includes('23P01');
}

@Injectable()
export class TurnosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly avisos: AvisosService,
  ) {}

  // ───────── Lectura ─────────

  async listar(
    centroId: string,
    quien: UsuarioAutenticado,
    dto: ListarTurnosDto,
  ) {
    const a = await this.actor(centroId, quien);
    if (a.rol === Rol.profesional && !a.profesionalId) return [];
    const { desde, hasta } = rangoDeFechas(dto.desde, dto.hasta, a.zona);
    const turnos = await this.db(centroId).turno.findMany({
      where: {
        inicio: { lt: hasta },
        fin: { gt: desde },
        ...(dto.incluirCancelados ? {} : NO_CANCELADO),
        ...(a.rol === Rol.profesional
          ? { profesionalId: a.profesionalId! }
          : {}),
        ...(dto.profesionalId ? { profesionalId: dto.profesionalId } : {}),
        ...(dto.salaId ? { salaId: dto.salaId } : {}),
        ...(dto.pacienteId ? { pacienteId: dto.pacienteId } : {}),
      },
      include: INCLUDE,
      orderBy: { inicio: 'asc' },
    });
    return turnos.map((t) => vista(t, a.zona));
  }

  /**
   * Ocupación de salas y profesionales en un rango, sin datos de pacientes:
   * sirve a cualquier rol para ver huecos libres.
   */
  async ocupacion(
    centroId: string,
    quien: UsuarioAutenticado,
    desdeF: string,
    hastaF: string,
  ) {
    const a = await this.actor(centroId, quien);
    const { desde, hasta } = rangoDeFechas(desdeF, hastaF, a.zona);
    const turnos = await this.db(centroId).turno.findMany({
      where: { inicio: { lt: hasta }, fin: { gt: desde }, ...NO_CANCELADO },
      select: { salaId: true, profesionalId: true, inicio: true, fin: true },
      orderBy: { inicio: 'asc' },
    });
    return turnos.map((t) => {
      const ini = aLocal(t.inicio, a.zona);
      return {
        salaId: t.salaId,
        profesionalId: t.profesionalId,
        fecha: ini.fecha,
        hora: ini.hora,
        horaFin: aLocal(t.fin, a.zona).hora,
      };
    });
  }

  async obtener(centroId: string, quien: UsuarioAutenticado, id: string) {
    const a = await this.actor(centroId, quien);
    return vista(await this.cargarPropio(a, id), a.zona);
  }

  // ───────── Escritura ─────────

  async crear(centroId: string, quien: UsuarioAutenticado, dto: CrearTurnoDto) {
    const a = await this.actor(centroId, quien);
    await this.verificarAlta(
      a,
      dto.profesionalId,
      dto.pacienteId,
      dto.salaId ?? null,
    );
    const inicio = aInstante(dto.fecha, dto.hora, a.zona);
    const fin = new Date(inicio.getTime() + dto.duracionMin * 60_000);
    await this.exigirSinChoques(a, {
      inicio,
      fin,
      salaId: dto.salaId ?? null,
      profesionalId: dto.profesionalId,
    });

    const turno = await this.guardar(() =>
      this.db(centroId).turno.create({
        data: sinCentro<Prisma.TurnoUncheckedCreateInput>({
          pacienteId: dto.pacienteId,
          profesionalId: dto.profesionalId,
          salaId: dto.salaId ?? null,
          inicio,
          fin,
          observaciones: dto.observaciones ?? null,
          creadoPorId: a.usuarioId,
        }),
        include: INCLUDE,
      }),
    );
    await this.avisarSiProfesional(
      a,
      TipoAviso.turno_creado,
      `${nombre(turno.profesional)} agendó un turno con ${nombre(turno.paciente)} el ${formatoCorto(inicio, a.zona)}${turno.sala ? ` en ${turno.sala.nombre}` : ''}.`,
      turno.id,
    );
    return vista(turno, a.zona);
  }

  async mover(
    centroId: string,
    quien: UsuarioAutenticado,
    id: string,
    dto: MoverTurnoDto,
  ) {
    const a = await this.actor(centroId, quien);
    const actual = await this.cargarPropio(a, id);
    this.exigirPendiente(actual);

    if (dto.profesionalId && dto.profesionalId !== actual.profesionalId) {
      if (a.rol === Rol.profesional) {
        throw new ForbiddenException(
          'No podés pasar el turno a otro profesional',
        );
      }
      await this.exigirActivo('profesional', dto.profesionalId, a);
    }
    if (dto.salaId) await this.exigirActivo('sala', dto.salaId, a);

    const local = aLocal(actual.inicio, a.zona);
    const duracion =
      dto.duracionMin ??
      Math.round((actual.fin.getTime() - actual.inicio.getTime()) / 60_000);
    const inicio = aInstante(
      dto.fecha ?? local.fecha,
      dto.hora ?? local.hora,
      a.zona,
    );
    const fin = new Date(inicio.getTime() + duracion * 60_000);
    const salaId = dto.salaId !== undefined ? dto.salaId : actual.salaId;
    const profesionalId = dto.profesionalId ?? actual.profesionalId;
    await this.exigirSinChoques(a, {
      inicio,
      fin,
      salaId,
      profesionalId,
      excluirId: id,
    });

    const turno = await this.guardar(() =>
      this.db(centroId).turno.update({
        where: { id },
        data: {
          inicio,
          fin,
          salaId,
          profesionalId,
          ...(dto.observaciones !== undefined
            ? { observaciones: dto.observaciones }
            : {}),
        },
        include: INCLUDE,
      }),
    );

    const cambioHorario = inicio.getTime() !== actual.inicio.getTime();
    const detalle = cambioHorario
      ? `del ${formatoCorto(actual.inicio, a.zona)} al ${formatoCorto(inicio, a.zona)}`
      : `del ${formatoCorto(inicio, a.zona)}`;
    const cambioSala =
      salaId !== actual.salaId
        ? ` (sala: ${turno.sala?.nombre ?? 'sin sala'})`
        : '';
    await this.avisarSiProfesional(
      a,
      TipoAviso.turno_movido,
      `${nombre(turno.profesional)} ${cambioHorario ? 'movió' : 'modificó'} el turno de ${nombre(turno.paciente)} ${detalle}${cambioSala}.`,
      turno.id,
    );
    return vista(turno, a.zona);
  }

  async cancelar(
    centroId: string,
    quien: UsuarioAutenticado,
    id: string,
    dto: CancelarTurnoDto,
  ) {
    const a = await this.actor(centroId, quien);
    const actual = await this.cargarPropio(a, id);
    this.exigirPendiente(actual);
    const observaciones = [
      actual.observaciones,
      dto.motivo ? `Cancelado: ${dto.motivo}` : null,
    ]
      .filter(Boolean)
      .join(' · ')
      .slice(0, 500);
    const turno = await this.db(centroId).$transaction(async (tx) => {
      await tx.cambioAsistencia.create({
        data: sinCentro<Prisma.CambioAsistenciaUncheckedCreateInput>({
          turnoId: id,
          estadoAnterior: actual.estadoAsistencia,
          estadoNuevo: EstadoAsistencia.cancelado_profesional,
          usuarioId: a.usuarioId,
        }),
      });
      return tx.turno.update({
        where: { id },
        data: {
          estadoAsistencia: EstadoAsistencia.cancelado_profesional,
          observaciones: observaciones || null,
        },
        include: INCLUDE,
      });
    });
    await this.avisarSiProfesional(
      a,
      TipoAviso.turno_cancelado,
      `${nombre(turno.profesional)} canceló el turno de ${nombre(turno.paciente)} del ${formatoCorto(turno.inicio, a.zona)}${dto.motivo ? `: ${dto.motivo}` : '.'}`,
      turno.id,
    );
    return vista(turno, a.zona);
  }

  /**
   * Marca la asistencia (o la vuelve a pendiente para corregirla). Se puede
   * corregir hasta que se cierre la liquidación del mes de ese profesional, y
   * cada cambio queda registrado con quién y cuándo.
   */
  async marcarAsistencia(
    centroId: string,
    quien: UsuarioAutenticado,
    id: string,
    dto: MarcarAsistenciaDto,
  ) {
    const a = await this.actor(centroId, quien);
    const actual = await this.cargarPropio(a, id);
    if (actual.estadoAsistencia === EstadoAsistencia.cancelado_profesional) {
      throw new BadRequestException('El turno está cancelado');
    }
    const estado = EstadoAsistencia[dto.estado];
    if (estado === actual.estadoAsistencia) return vista(actual, a.zona);

    const yaEmpezo = actual.inicio.getTime() <= Date.now();
    if (
      !yaEmpezo &&
      (estado === EstadoAsistencia.presente ||
        estado === EstadoAsistencia.ausente_sin_aviso)
    ) {
      throw new BadRequestException(
        'El turno todavía no empezó: solo se puede marcar "ausente con aviso"',
      );
    }
    await this.exigirMesAbierto(a, actual);

    const turno = await this.db(centroId).$transaction(async (tx) => {
      await tx.cambioAsistencia.create({
        data: sinCentro<Prisma.CambioAsistenciaUncheckedCreateInput>({
          turnoId: id,
          estadoAnterior: actual.estadoAsistencia,
          estadoNuevo: estado,
          usuarioId: a.usuarioId,
        }),
      });
      return tx.turno.update({
        where: { id },
        data: { estadoAsistencia: estado },
        include: INCLUDE,
      });
    });
    return vista(turno, a.zona);
  }

  /** Cambios de asistencia de un turno, del más reciente al más viejo. */
  async cambiosDeAsistencia(
    centroId: string,
    quien: UsuarioAutenticado,
    id: string,
  ) {
    const a = await this.actor(centroId, quien);
    await this.cargarPropio(a, id);
    const cambios = await this.db(centroId).cambioAsistencia.findMany({
      where: { turnoId: id },
      include: { usuario: { select: { id: true, nombre: true } } },
      orderBy: { creadoEn: 'desc' },
    });
    return cambios.map((c) => ({
      estadoAnterior: c.estadoAnterior,
      estadoNuevo: c.estadoNuevo,
      usuario: c.usuario,
      fecha: c.creadoEn.toISOString(),
    }));
  }

  /**
   * Turnos semanales (ej. todos los martes 10:00). Crea los que puede y devuelve
   * las fechas que chocan con otros turnos, en lugar de rechazar todo.
   */
  async crearRecurrencia(
    centroId: string,
    quien: UsuarioAutenticado,
    dto: CrearRecurrenciaDto,
  ) {
    const a = await this.actor(centroId, quien);
    const salaId = dto.salaId ?? null;
    await this.verificarAlta(a, dto.profesionalId, dto.pacienteId, salaId);
    const fechaHasta =
      dto.fechaHasta ?? sumarDias(dto.fechaDesde, SEMANAS_POR_DEFECTO * 7 - 1);
    const fechas = fechasSemanales(dto.diaSemana, dto.fechaDesde, fechaHasta);
    if (!fechas.length)
      throw new BadRequestException('No hay ninguna fecha en ese período');

    const db = this.db(centroId);
    const recurrencia = await db.recurrencia.create({
      data: sinCentro<Prisma.RecurrenciaUncheckedCreateInput>({
        pacienteId: dto.pacienteId,
        profesionalId: dto.profesionalId,
        salaId,
        diaSemana: dto.diaSemana,
        hora: new Date(`1970-01-01T${dto.hora}:00Z`),
        duracionMin: dto.duracionMin,
        fechaDesde: new Date(`${dto.fechaDesde}T00:00:00Z`),
        fechaHasta: new Date(`${fechaHasta}T00:00:00Z`),
      }),
    });

    const creados: TurnoVista[] = [];
    const conflictos: { fecha: string; motivo: string }[] = [];
    for (const fecha of fechas) {
      const inicio = aInstante(fecha, dto.hora, a.zona);
      const fin = new Date(inicio.getTime() + dto.duracionMin * 60_000);
      const choques = await this.choques(a, {
        inicio,
        fin,
        salaId,
        profesionalId: dto.profesionalId,
      });
      if (choques.length) {
        conflictos.push({ fecha, motivo: choques.join('. ') });
        continue;
      }
      try {
        const t = await db.turno.create({
          data: sinCentro<Prisma.TurnoUncheckedCreateInput>({
            pacienteId: dto.pacienteId,
            profesionalId: dto.profesionalId,
            salaId,
            inicio,
            fin,
            recurrenciaId: recurrencia.id,
            observaciones: dto.observaciones ?? null,
            creadoPorId: a.usuarioId,
          }),
          include: INCLUDE,
        });
        creados.push(vista(t, a.zona));
      } catch (e) {
        if (!esSuperposicion(e)) throw e;
        conflictos.push({
          fecha,
          motivo: 'El horario se superpone con otro turno',
        });
      }
    }

    if (!creados.length) {
      await db.recurrencia.delete({ where: { id: recurrencia.id } });
      throw new ConflictException({
        statusCode: 409,
        message: 'Ninguna fecha está libre: todas chocan con otros turnos',
        conflictos,
      });
    }

    const primero = creados[0];
    await this.avisarSiProfesional(
      a,
      TipoAviso.turno_creado,
      `${nombre(primero.profesional)} agendó turnos semanales con ${nombre(primero.paciente)}: ${creados.length} turno(s) desde el ${formatoCorto(new Date(primero.inicio), a.zona)}${conflictos.length ? ` (${conflictos.length} fecha(s) ocupadas no se agendaron)` : ''}.`,
      primero.id,
    );
    return { recurrenciaId: recurrencia.id, creados, conflictos };
  }

  /** Corta una recurrencia: cancela sus turnos pendientes desde una fecha. */
  async finalizarRecurrencia(
    centroId: string,
    quien: UsuarioAutenticado,
    id: string,
    desdeF: string,
  ) {
    const a = await this.actor(centroId, quien);
    const db = this.db(centroId);
    const rec = await db.recurrencia.findUnique({
      where: { id },
      include: { paciente: true, profesional: true },
    });
    if (
      !rec ||
      (a.rol === Rol.profesional && rec.profesionalId !== a.profesionalId)
    ) {
      throw new NotFoundException('Turnos semanales no encontrados');
    }
    const desde = aInstante(desdeF, '00:00', a.zona);
    const { count } = await db.turno.updateMany({
      where: {
        recurrenciaId: id,
        inicio: { gte: desde },
        estadoAsistencia: EstadoAsistencia.pendiente,
      },
      data: { estadoAsistencia: EstadoAsistencia.cancelado_profesional },
    });
    await db.recurrencia.update({
      where: { id },
      data: { fechaHasta: new Date(`${sumarDias(desdeF, -1)}T00:00:00Z`) },
    });
    if (count) {
      await this.avisarSiProfesional(
        a,
        TipoAviso.turno_cancelado,
        `${nombre(rec.profesional)} terminó los turnos semanales con ${nombre(rec.paciente)} desde el ${desdeF.split('-').reverse().join('/')}: ${count} turno(s) cancelado(s).`,
        null,
      );
    }
    return { cancelados: count };
  }

  // ───────── Internos ─────────

  private db(centroId: string): ClienteDeCentro {
    return this.prisma.paraCentro(centroId);
  }

  private async actor(
    centroId: string,
    quien: UsuarioAutenticado,
  ): Promise<Actor> {
    const centro = await this.prisma.centro.findUniqueOrThrow({
      where: { id: centroId },
      select: { zonaHoraria: true },
    });
    let profesionalId: string | null = null;
    if (quien.rol === Rol.profesional) {
      const yo = await this.db(centroId).profesional.findFirst({
        where: { usuarioId: quien.usuarioId, activo: true },
        select: { id: true },
      });
      profesionalId = yo?.id ?? null;
    }
    return {
      centroId,
      usuarioId: quien.usuarioId,
      rol: quien.rol!,
      profesionalId,
      zona: centro.zonaHoraria,
    };
  }

  /** Carga un turno; un profesional solo puede acceder a los suyos. */
  private async cargarPropio(a: Actor, id: string): Promise<TurnoCompleto> {
    const t = await this.db(a.centroId).turno.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (
      !t ||
      (a.rol === Rol.profesional && t.profesionalId !== a.profesionalId)
    ) {
      throw new NotFoundException('Turno no encontrado');
    }
    return t;
  }

  private exigirPendiente(t: TurnoCompleto): void {
    if (t.estadoAsistencia === EstadoAsistencia.cancelado_profesional) {
      throw new BadRequestException('El turno está cancelado');
    }
    if (t.estadoAsistencia !== EstadoAsistencia.pendiente) {
      throw new BadRequestException(
        'El turno ya tiene registrada la asistencia',
      );
    }
  }

  /** El mes del turno no puede tener cerrada la liquidación del profesional. */
  private async exigirMesAbierto(a: Actor, t: TurnoCompleto): Promise<void> {
    const mes = aLocal(t.inicio, a.zona).fecha.slice(0, 7);
    const cerrada = await this.db(a.centroId).liquidacion.count({
      where: {
        profesionalId: t.profesionalId,
        periodo: new Date(`${mes}-01T00:00:00Z`),
        estado: { in: [EstadoLiquidacion.cerrada, EstadoLiquidacion.pagada] },
      },
    });
    if (cerrada) {
      throw new ConflictException(
        'La liquidación de ese mes ya está cerrada: la asistencia no se puede cambiar',
      );
    }
  }

  /** Permisos y datos para dar de alta un turno. */
  private async verificarAlta(
    a: Actor,
    profesionalId: string,
    pacienteId: string,
    salaId: string | null,
  ): Promise<void> {
    if (a.rol === Rol.profesional) {
      if (!a.profesionalId) {
        throw new ForbiddenException(
          'Tu cuenta no está vinculada a un profesional del centro',
        );
      }
      if (profesionalId !== a.profesionalId) {
        throw new ForbiddenException('Solo podés agendar tus propios turnos');
      }
      const asignado = await this.db(a.centroId).pacienteProfesional.count({
        where: { pacienteId, profesionalId },
      });
      if (!asignado)
        throw new ForbiddenException('El paciente no está asignado a vos');
    }
    await this.exigirActivo('paciente', pacienteId, a);
    await this.exigirActivo('profesional', profesionalId, a);
    if (salaId) await this.exigirActivo('sala', salaId, a);
  }

  private async exigirActivo(
    que: 'paciente' | 'profesional' | 'sala',
    id: string,
    a: Actor,
  ): Promise<void> {
    const db = this.db(a.centroId);
    const existe =
      que === 'paciente'
        ? await db.paciente.count({ where: { id, activo: true } })
        : que === 'profesional'
          ? await db.profesional.count({ where: { id, activo: true } })
          : await db.sala.count({ where: { id, activa: true } });
    if (!existe)
      throw new BadRequestException(`${que}Id: no existe o está dado de baja`);
  }

  /** Mensajes de choque con otros turnos (sin datos de pacientes). */
  private async choques(
    a: Actor,
    t: {
      inicio: Date;
      fin: Date;
      salaId: string | null;
      profesionalId: string;
      excluirId?: string;
    },
  ): Promise<string[]> {
    const otros = await this.db(a.centroId).turno.findMany({
      where: {
        ...NO_CANCELADO,
        inicio: { lt: t.fin },
        fin: { gt: t.inicio },
        OR: [
          { profesionalId: t.profesionalId },
          ...(t.salaId ? [{ salaId: t.salaId }] : []),
        ],
        ...(t.excluirId ? { id: { not: t.excluirId } } : {}),
      },
      include: INCLUDE,
      orderBy: { inicio: 'asc' },
    });
    const mensajes: string[] = [];
    for (const o of otros) {
      const de = aLocal(o.inicio, a.zona).hora;
      const a_ = aLocal(o.fin, a.zona).hora;
      if (t.salaId && o.salaId === t.salaId) {
        mensajes.push(
          `La sala ${o.sala!.nombre} está ocupada de ${de} a ${a_}`,
        );
      }
      if (o.profesionalId === t.profesionalId) {
        mensajes.push(
          `${nombre(o.profesional)} ya tiene un turno de ${de} a ${a_}`,
        );
      }
    }
    return [...new Set(mensajes)];
  }

  private async exigirSinChoques(
    a: Actor,
    t: {
      inicio: Date;
      fin: Date;
      salaId: string | null;
      profesionalId: string;
      excluirId?: string;
    },
  ): Promise<void> {
    const choques = await this.choques(a, t);
    if (choques.length) {
      throw new ConflictException({
        statusCode: 409,
        message: choques.join('. '),
        choques,
      });
    }
  }

  /** Guarda y traduce el rechazo de la base por superposición (dos pedidos a la vez). */
  private async guardar<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (esSuperposicion(e)) {
        throw new ConflictException('El horario se superpone con otro turno');
      }
      throw e;
    }
  }

  private async avisarSiProfesional(
    a: Actor,
    tipo: TipoAviso,
    mensaje: string,
    turnoId: string | null,
  ): Promise<void> {
    if (a.rol !== Rol.profesional) return;
    await this.avisos.avisarCambioDeAgenda(
      a.centroId,
      a.usuarioId,
      tipo,
      mensaje,
      turnoId,
    );
  }
}

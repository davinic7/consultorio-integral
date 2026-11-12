import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import {
  aLocal,
  diasDelMes,
  periodoDe,
  rangoDeFechas,
} from '../common/tiempo.js';
import {
  EstadoAsistencia,
  EstadoPago,
  Prisma,
  TipoPrestacion,
} from '../generated/prisma/client.js';
import { sinCentro, type ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ActualizarPagoDto,
  ActualizarPrestacionDto,
  CrearPagoDto,
  ListarPrestacionesDto,
  PagoLoteDto,
} from './cobros.schemas.js';
import {
  alcanceDe,
  claveMes,
  ESTADOS_CERRADOS,
  INCLUDE_PRESTACION,
  mesesCerrados,
  ordenDisponible,
  precioVigente,
  vistaPrestacion,
  type DbCobros,
  type PrestacionCompleta,
} from './comun.js';
import { montoFaltazo, type ReglaFaltazo } from './faltazo.js';
import { CERO, num, sumar, type Decimal } from './reglas.js';

const dia = (fecha: string) => new Date(`${fecha}T00:00:00Z`);

/** Lo que todavía se puede cobrar: monto − (cobrado + pagos en curso). */
function disponible(
  p: {
    monto: Decimal;
    pagos: { id: string; monto: Decimal; estado: EstadoPago }[];
  },
  sinContarPagoId?: string,
): Decimal {
  const comprometido = sumar(
    p.pagos
      .filter(
        (x) => x.id !== sinContarPagoId && x.estado !== EstadoPago.rechazado,
      )
      .map((x) => x.monto),
  );
  return Prisma.Decimal.max(p.monto.minus(comprometido), CERO);
}

/**
 * Prestaciones (una por turno presente) y sus pagos. La prestación nace y se
 * borra con la asistencia (ver TurnosService.marcarAsistencia): toma la cobertura
 * del paciente, el precio vigente ese día y, si la obra social la pide, una orden
 * con sesiones libres.
 */
@Injectable()
export class PrestacionesService {
  constructor(private readonly prisma: PrismaService) {}

  // ───────── Con la asistencia ─────────

  /** Crea la prestación de un turno que pasó a presente (si no la tiene). */
  async crearParaTurno(
    tx: DbCobros,
    turno: {
      id: string;
      pacienteId: string;
      profesionalId: string;
      inicio: Date;
    },
    zona: string,
  ): Promise<void> {
    const existe = await tx.prestacion.count({ where: { turnoId: turno.id } });
    if (existe) return;
    const fecha = aLocal(turno.inicio, zona).fecha;
    const paciente = await tx.paciente.findUniqueOrThrow({
      where: { id: turno.pacienteId },
      select: {
        financiadorId: true,
        financiador: { select: { requiereOrden: true } },
      },
    });
    const financiadorId = paciente.financiadorId;
    await tx.prestacion.create({
      data: sinCentro<Prisma.PrestacionUncheckedCreateInput>({
        turnoId: turno.id,
        pacienteId: turno.pacienteId,
        profesionalId: turno.profesionalId,
        financiadorId,
        fecha: dia(fecha),
        periodo: periodoDe(fecha.slice(0, 7)),
        monto: await precioVigente(
          tx,
          turno.pacienteId,
          financiadorId,
          dia(fecha),
        ),
        ordenId:
          financiadorId && paciente.financiador?.requiereOrden
            ? await ordenDisponible(
                tx,
                turno.pacienteId,
                financiadorId,
                dia(fecha),
              )
            : null,
      }),
    });
  }

  /**
   * Faltazo cobrable de un turno (lo decide quien marca según la regla del
   * profesional): solo a pacientes particulares, nunca a una obra social. El
   * monto sale de la regla sobre el precio particular vigente ese día.
   */
  async crearFaltazo(
    tx: DbCobros,
    turno: {
      id: string;
      pacienteId: string;
      profesionalId: string;
      inicio: Date;
    },
    regla: ReglaFaltazo,
    zona: string,
  ): Promise<void> {
    const existe = await tx.prestacion.count({ where: { turnoId: turno.id } });
    if (existe) return;
    const paciente = await tx.paciente.findUniqueOrThrow({
      where: { id: turno.pacienteId },
      select: { financiadorId: true },
    });
    if (paciente.financiadorId) return;
    const fecha = aLocal(turno.inicio, zona).fecha;
    const precio = await precioVigente(tx, turno.pacienteId, null, dia(fecha));
    await tx.prestacion.create({
      data: sinCentro<Prisma.PrestacionUncheckedCreateInput>({
        turnoId: turno.id,
        tipo: TipoPrestacion.faltazo,
        pacienteId: turno.pacienteId,
        profesionalId: turno.profesionalId,
        financiadorId: null,
        fecha: dia(fecha),
        periodo: periodoDe(fecha.slice(0, 7)),
        monto: montoFaltazo(regla, precio),
      }),
    });
  }

  /**
   * Anula un faltazo (recepción, la administración o el profesional, el suyo),
   * con motivo. Deja de cobrarse y de entrar en la liquidación. No se puede si
   * tiene pagos, está facturado o el mes ya está liquidado.
   */
  async anular(
    centroId: string,
    quien: UsuarioAutenticado,
    id: string,
    motivo: string,
  ) {
    const db = this.db(centroId);
    const p = await this.cargar(db, id);
    const alcance = await alcanceDe(db, quien);
    if (alcance.profesionalId && alcance.profesionalId !== p.profesionalId)
      throw new ForbiddenException('Solo podés anular tus faltazos');
    if (p.tipo !== TipoPrestacion.faltazo)
      throw new BadRequestException('Solo se anulan faltazos');
    if (p.anuladaEn) throw new ConflictException('El faltazo ya está anulado');
    if (p.pagos.some((x) => x.estado !== EstadoPago.rechazado))
      throw new ConflictException(
        'El faltazo tiene pagos registrados: borralos antes de anularlo',
      );
    if (p.facturada || p.facturaId)
      throw new ConflictException('El faltazo ya está facturado');
    if (await this.estaCerrada(db, p.profesionalId, p.periodo))
      throw new ConflictException(
        'La liquidación de ese mes ya está cerrada: no se puede anular',
      );
    await db.prestacion.update({
      where: { id },
      data: {
        anuladaEn: new Date(),
        anuladaPorId: quien.usuarioId,
        motivoAnulacion: motivo,
      },
    });
    return this.vista(db, centroId, id);
  }

  /** Antes de sacar un turno de "presente": su prestación no puede tener pagos ni estar facturada. */
  async exigirQuitable(db: DbCobros, turnoId: string): Promise<void> {
    const p = await db.prestacion.findFirst({
      where: { turnoId },
      select: { facturada: true, _count: { select: { pagos: true } } },
    });
    if (!p) return;
    if (p._count.pagos) {
      throw new ConflictException(
        'La sesión tiene pagos registrados: borralos en Cobros antes de cambiar la asistencia',
      );
    }
    if (p.facturada) {
      throw new ConflictException(
        'La sesión ya está facturada: desmarcala en Cobros antes de cambiar la asistencia',
      );
    }
  }

  async quitarDeTurno(tx: DbCobros, turnoId: string): Promise<void> {
    await tx.prestacion.deleteMany({ where: { turnoId } });
  }

  // ───────── Consultas ─────────

  async listar(
    centroId: string,
    quien: UsuarioAutenticado,
    dto: ListarPrestacionesDto,
  ) {
    const db = this.db(centroId);
    const [zona, alcance] = await Promise.all([
      this.zona(centroId),
      alcanceDe(db, quien),
    ]);
    const filtro: Prisma.PrestacionWhereInput = {};
    if (dto.mes) filtro.periodo = periodoDe(dto.mes);
    if (dto.pacienteId) filtro.pacienteId = dto.pacienteId;
    if (dto.profesionalId) filtro.profesionalId = dto.profesionalId;
    if (dto.financiadorId) filtro.financiadorId = dto.financiadorId;
    const filas = await db.prestacion.findMany({
      where: { AND: [filtro, alcance] },
      include: INCLUDE_PRESTACION,
      orderBy: [{ fecha: 'desc' }, { turno: { inicio: 'desc' } }],
      // Sin mes (historial de un paciente): las más recientes.
      take: dto.mes ? undefined : 300,
    });
    const vistas = await this.vistas(db, filas, zona);
    if (dto.estado === 'cobrada')
      return vistas.filter((v) => v.estadoCobro === 'cobrada');
    if (dto.estado === 'por_cobrar')
      return vistas.filter((v) => v.estadoCobro !== 'cobrada');
    return vistas;
  }

  /** Turnos presentes del mes que no tienen prestación (datos de antes de este módulo). */
  async presentesSinPrestacion(
    db: DbCobros,
    mes: string,
    zona: string,
    alcance: { profesionalId?: string } = {},
  ) {
    const { primero, ultimo } = diasDelMes(mes);
    const rango = rangoDeFechas(primero, ultimo, zona);
    return db.turno.findMany({
      where: {
        ...alcance,
        estadoAsistencia: EstadoAsistencia.presente,
        inicio: { gte: rango.desde, lt: rango.hasta },
        prestacion: { is: null },
      },
      select: {
        id: true,
        pacienteId: true,
        profesionalId: true,
        inicio: true,
        paciente: { select: { id: true, nombre: true, apellido: true } },
        profesional: {
          select: { id: true, nombre: true, apellido: true, disciplina: true },
        },
      },
      orderBy: { inicio: 'asc' },
    });
  }

  // ───────── Cambios ─────────

  async actualizar(centroId: string, id: string, dto: ActualizarPrestacionDto) {
    const db = this.db(centroId);
    const p = await this.cargar(db, id);
    const cerrada = await this.estaCerrada(db, p.profesionalId, p.periodo);
    if (
      p.facturaId &&
      (dto.monto !== undefined || dto.financiadorId !== undefined)
    ) {
      throw new ConflictException(
        'La sesión ya tiene factura electrónica: el monto y la cobertura no se pueden cambiar',
      );
    }
    if (
      cerrada &&
      (dto.monto !== undefined || dto.financiadorId !== undefined)
    ) {
      throw new ConflictException(
        'La liquidación de ese mes ya está cerrada: el monto y la cobertura no se pueden cambiar',
      );
    }
    const data: Prisma.PrestacionUncheckedUpdateInput = {};
    let financiadorId = p.financiadorId;

    if (
      dto.financiadorId !== undefined &&
      dto.financiadorId !== p.financiadorId
    ) {
      if (p.pagos.length) {
        throw new ConflictException(
          'La sesión tiene pagos registrados: no se puede cambiar la cobertura',
        );
      }
      financiadorId = dto.financiadorId;
      data.financiadorId = financiadorId;
      data.ordenId = null;
      if (financiadorId) {
        const f = await db.financiador.findUnique({
          where: { id: financiadorId },
          select: { requiereOrden: true },
        });
        if (!f) throw new NotFoundException('Obra social no encontrada');
        if (f.requiereOrden)
          data.ordenId = await ordenDisponible(
            db,
            p.pacienteId,
            financiadorId,
            p.fecha,
            p.id,
          );
      }
      if (!p.montoManual && dto.monto === undefined)
        data.monto = await precioVigente(
          db,
          p.pacienteId,
          financiadorId,
          p.fecha,
        );
    }

    if (dto.monto !== undefined) {
      data.montoManual = dto.monto !== null;
      data.monto =
        dto.monto ??
        (await precioVigente(db, p.pacienteId, financiadorId, p.fecha));
    }

    if (dto.ordenId !== undefined) {
      if (dto.ordenId) {
        const o = await db.orden.findUnique({
          where: { id: dto.ordenId },
          select: {
            pacienteId: true,
            financiadorId: true,
            sesiones: true,
            _count: {
              select: { prestaciones: { where: { id: { not: p.id } } } },
            },
          },
        });
        if (!o || o.pacienteId !== p.pacienteId)
          throw new NotFoundException('Orden no encontrada');
        if (o.financiadorId !== financiadorId)
          throw new BadRequestException('La orden es de otra obra social');
        if (o._count.prestaciones >= o.sesiones)
          throw new ConflictException('La orden ya usó todas sus sesiones');
      }
      data.ordenId = dto.ordenId;
    }
    if (dto.token !== undefined) data.token = dto.token;
    if (dto.facturada !== undefined) data.facturada = dto.facturada;
    if (dto.fechaDeclarada !== undefined)
      data.fechaDeclarada = dto.fechaDeclarada ? dia(dto.fechaDeclarada) : null;

    const act = await db.prestacion.update({
      where: { id },
      data,
      include: INCLUDE_PRESTACION,
    });
    return vistaPrestacion(act, await this.zona(centroId), cerrada);
  }

  /** Marca (o desmarca) varias prestaciones como presentadas o facturadas. */
  async facturar(centroId: string, ids: string[], facturada: boolean) {
    const r = await this.db(centroId).prestacion.updateMany({
      // Las que tienen factura electrónica no se desmarcan.
      where: { id: { in: ids }, ...(facturada ? {} : { facturaId: null }) },
      data: { facturada },
    });
    return { actualizadas: r.count };
  }

  /**
   * Crea las prestaciones que faltan en el mes (turnos presentes sin prestación,
   * por ejemplo de antes de este módulo). Saltea los meses ya liquidados.
   */
  async generarFaltantes(centroId: string, mes: string) {
    const db = this.db(centroId);
    const zona = await this.zona(centroId);
    const turnos = await this.presentesSinPrestacion(db, mes, zona);
    const cerrados = await mesesCerrados(db, { periodo: periodoDe(mes) });
    const abiertos = turnos.filter(
      (t) => !cerrados.has(claveMes(t.profesionalId, periodoDe(mes))),
    );
    await db.$transaction(async (tx) => {
      for (const t of abiertos) await this.crearParaTurno(tx, t, zona);
    });
    return {
      creadas: abiertos.length,
      omitidas: turnos.length - abiertos.length,
    };
  }

  // ───────── Pagos ─────────

  async registrarPago(
    centroId: string,
    prestacionId: string,
    dto: CrearPagoDto,
  ) {
    const db = this.db(centroId);
    const p = await this.cargar(db, prestacionId);
    if (p.anuladaEn)
      throw new ConflictException('El faltazo está anulado: no se cobra');
    const libre = disponible(p);
    const monto =
      dto.monto !== undefined ? new Prisma.Decimal(dto.monto) : libre;
    if (dto.estado !== EstadoPago.rechazado) this.exigirQueEntre(monto, libre);
    await db.pago.create({
      data: sinCentro<Prisma.PagoUncheckedCreateInput>({
        prestacionId,
        monto,
        fecha: dia(dto.fecha ?? (await this.hoy(centroId))),
        medio: dto.medio,
        estado: dto.estado,
        observaciones: dto.observaciones ?? null,
      }),
    });
    return this.vista(db, centroId, prestacionId);
  }

  /** Cobra el saldo de varias prestaciones de una vez (ej. lo que pagó la obra social en el mes). */
  async pagarLote(centroId: string, dto: PagoLoteDto) {
    const db = this.db(centroId);
    const prestaciones = await db.prestacion.findMany({
      where: { id: { in: dto.prestacionIds } },
      select: { id: true, monto: true, pagos: true, anuladaEn: true },
    });
    if (prestaciones.length !== new Set(dto.prestacionIds).size)
      throw new NotFoundException('Alguna de las sesiones no existe');
    if (prestaciones.some((p) => p.anuladaEn))
      throw new ConflictException('Hay faltazos anulados en la selección');
    const fecha = dia(dto.fecha ?? (await this.hoy(centroId)));
    const pagos = prestaciones
      .map((p) => ({ prestacionId: p.id, monto: disponible(p) }))
      .filter((x) => x.monto.gt(0));
    await db.$transaction(async (tx) => {
      for (const x of pagos) {
        await tx.pago.create({
          data: sinCentro<Prisma.PagoUncheckedCreateInput>({
            ...x,
            fecha,
            medio: dto.medio,
            estado: dto.estado,
            observaciones: dto.observaciones ?? null,
          }),
        });
      }
    });
    return {
      pagos: pagos.length,
      total: num(sumar(pagos.map((x) => x.monto))),
      sinSaldo: prestaciones.length - pagos.length,
    };
  }

  async actualizarPago(centroId: string, id: string, dto: ActualizarPagoDto) {
    const db = this.db(centroId);
    const pago = await db.pago.findUnique({
      where: { id },
      select: { prestacionId: true },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado');
    const p = await this.cargar(db, pago.prestacionId);
    const actual = p.pagos.find((x) => x.id === id)!;
    const estado = dto.estado ?? actual.estado;
    if (estado !== EstadoPago.rechazado) {
      const monto =
        dto.monto !== undefined ? new Prisma.Decimal(dto.monto) : actual.monto;
      this.exigirQueEntre(monto, disponible(p, id));
    }
    await db.pago.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.fecha ? { fecha: dia(dto.fecha) } : {}),
      },
    });
    return this.vista(db, centroId, p.id);
  }

  async borrarPago(centroId: string, id: string) {
    const db = this.db(centroId);
    const pago = await db.pago.findUnique({
      where: { id },
      select: { prestacionId: true },
    });
    if (!pago) throw new NotFoundException('Pago no encontrado');
    await db.pago.delete({ where: { id } });
    return this.vista(db, centroId, pago.prestacionId);
  }

  // ───────── Internos ─────────

  /** Vistas de varias prestaciones, sabiendo qué meses están liquidados. */
  async vistas(db: DbCobros, filas: PrestacionCompleta[], zona: string) {
    const periodos = [...new Set(filas.map((f) => f.periodo.getTime()))].map(
      (t) => new Date(t),
    );
    const cerrados = periodos.length
      ? await mesesCerrados(db, { periodo: { in: periodos } })
      : new Set<string>();
    return filas.map((f) =>
      vistaPrestacion(
        f,
        zona,
        cerrados.has(claveMes(f.profesionalId, f.periodo)),
      ),
    );
  }

  private exigirQueEntre(monto: Decimal, libre: Decimal): void {
    if (monto.lte(0)) {
      throw new ConflictException(
        libre.isZero()
          ? 'La sesión no tiene saldo para cobrar'
          : 'El monto tiene que ser mayor a 0',
      );
    }
    if (monto.gt(libre)) {
      throw new ConflictException(
        `El pago supera el saldo de la sesión ($${num(libre).toLocaleString('es-AR')})`,
      );
    }
  }

  private async vista(db: DbCobros, centroId: string, id: string) {
    const p = await this.cargar(db, id);
    const cerrada = await this.estaCerrada(db, p.profesionalId, p.periodo);
    return vistaPrestacion(p, await this.zona(centroId), cerrada);
  }

  private async cargar(db: DbCobros, id: string): Promise<PrestacionCompleta> {
    const p = await db.prestacion.findUnique({
      where: { id },
      include: INCLUDE_PRESTACION,
    });
    if (!p) throw new NotFoundException('Sesión no encontrada');
    return p;
  }

  private async estaCerrada(
    db: DbCobros,
    profesionalId: string,
    periodo: Date,
  ): Promise<boolean> {
    return (
      (await db.liquidacion.count({
        where: { profesionalId, periodo, estado: { in: ESTADOS_CERRADOS } },
      })) > 0
    );
  }

  private db(centroId: string): ClienteDeCentro {
    return this.prisma.paraCentro(centroId);
  }

  async zona(centroId: string): Promise<string> {
    const c = await this.prisma.centro.findUniqueOrThrow({
      where: { id: centroId },
      select: { zonaHoraria: true },
    });
    return c.zonaHoraria;
  }

  private async hoy(centroId: string): Promise<string> {
    return aLocal(new Date(), await this.zona(centroId)).fecha;
  }
}

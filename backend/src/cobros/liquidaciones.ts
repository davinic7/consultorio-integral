import { RequiereModulo } from '../planes/planes.js';
import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { idParam } from '../common/comunes.js';
import { ApiBodyZod } from '../common/zod.js';
import { diasDelMes, periodoDe, rangoDeFechas } from '../common/tiempo.js';
import {
  EstadoAsistencia,
  EstadoLiquidacion,
  Modulo,
  Prisma,
  Rol,
  TipoPrestacion,
} from '../generated/prisma/client.js';
import type { ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { generarLiquidacionSchema, mesSchema } from './cobros.schemas.js';
import { alcanceDe, ESTADOS_CERRADOS, type DbCobros } from './comun.js';
import { PrestacionesService } from './prestaciones.service.js';
import {
  calcularAlquiler,
  horasDe,
  type ComponenteCalculado,
} from './alquiler.js';
import { CERO, cobroDe, num, sumar, type Decimal } from './reglas.js';

const SELECT_PROFESIONAL = {
  id: true,
  nombre: true,
  apellido: true,
  disciplina: true,
  activo: true,
} satisfies Prisma.ProfesionalSelect;

/** Acuerdo con el que se calculó (o se cerró) el mes. */
export interface AcuerdoUsado {
  id: string | null;
  /** YYYY-MM desde el que rige; null en liquidaciones anteriores a los acuerdos. */
  vigenteDesde: string | null;
  nota: string | null;
}

/** Totales de un profesional en un mes, en Decimal (para seguir operando). */
export interface TotalesProfesional {
  profesional: {
    id: string;
    nombre: string;
    apellido: string;
    disciplina: string;
  };
  sesiones: number;
  /** Faltazos cobrables del mes (incluidos en lo facturado). */
  faltazos: number;
  montoFaltazos: Decimal;
  bruto: Decimal;
  cobrado: Decimal;
  /** Lo que el profesional le debe al centro por el alquiler del mes. */
  alquiler: Decimal;
  componentes: ComponenteCalculado[];
  cobraElCentro: boolean;
  /** Positivo: el centro le paga al profesional. Negativo: el profesional le debe al centro. */
  saldo: Decimal;
  acuerdo: AcuerdoUsado | null;
  liquidacion: {
    id: string;
    estado: EstadoLiquidacion;
    cerradaEn: Date | null;
    pagadaEn: Date | null;
  } | null;
  /** Turnos del mes que siguen sin asistencia marcada. */
  sinMarcar: number;
  /** Turnos presentes sin prestación (datos anteriores a cobros). */
  sinPrestacion: number;
  /** Para guardar al cerrar: horas de sala y precio de la sesión usados. */
  bases: { horasSala: number; precioSesion: number };
}

/** Lo que se guarda en liquidaciones.detalle_alquiler al cerrar. */
interface DetalleAlquiler {
  acuerdoId: string | null;
  vigenteDesde: string | null;
  cobraElCentro: boolean;
  componentes: ComponenteCalculado[];
  horasSala?: number;
  precioSesion?: number;
  nota?: string | null;
}

function vistaTotales(t: TotalesProfesional) {
  return {
    profesional: t.profesional,
    sesiones: t.sesiones,
    faltazos: t.faltazos,
    montoFaltazos: num(t.montoFaltazos),
    facturado: num(t.bruto),
    cobrado: num(t.cobrado),
    alquiler: num(t.alquiler),
    componentes: t.componentes,
    cobraElCentro: t.cobraElCentro,
    saldo: num(t.saldo),
    acuerdo: t.acuerdo,
    liquidacion: t.liquidacion && {
      id: t.liquidacion.id,
      estado: t.liquidacion.estado,
      cerradaEn: t.liquidacion.cerradaEn?.toISOString() ?? null,
      pagadaEn: t.liquidacion.pagadaEn?.toISOString() ?? null,
    },
    sinMarcar: t.sinMarcar,
    sinPrestacion: t.sinPrestacion,
  };
}

const mesDe = (d: Date) => d.toISOString().slice(0, 7);

/**
 * Liquidación mensual por profesional: lo facturado en el mes (sus prestaciones)
 * y lo que debe al centro según su acuerdo de alquiler vigente ese mes (ver
 * alquiler.ts). Si el centro cobra por él, el saldo es lo facturado menos el
 * alquiler; si cobra el profesional, el saldo es lo que le debe al centro.
 *
 * "Generar" la deja cerrada con los totales guardados: desde ahí no se puede
 * cambiar la asistencia ni los montos de ese mes. Después se marca pagada. Una
 * cerrada se puede reabrir (vuelve a borrador); una pagada no.
 */
@Injectable()
export class LiquidacionesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prestaciones: PrestacionesService,
  ) {}

  async listar(centroId: string, quien: UsuarioAutenticado, mes: string) {
    const db = this.db(centroId);
    const alcance = await alcanceDe(db, quien);
    const totales = await this.calcular(db, centroId, mes, alcance);
    return totales.map(vistaTotales);
  }

  /**
   * Totales por profesional. Las liquidaciones cerradas o pagadas muestran lo que
   * se guardó al cerrarlas; las demás, el cálculo del momento.
   */
  async calcular(
    db: DbCobros,
    centroId: string,
    mes: string,
    alcance: { profesionalId?: string } = {},
  ): Promise<TotalesProfesional[]> {
    const periodo = periodoDe(mes);
    const zona = await this.prestaciones.zona(centroId);
    const { primero, ultimo } = diasDelMes(mes);
    const rango = rangoDeFechas(primero, ultimo, zona);
    const enElMes = { inicio: { gte: rango.desde, lt: rango.hasta } };

    const [prestaciones, liquidaciones, sinMarcar, sinPrestacion] =
      await Promise.all([
        db.prestacion.findMany({
          where: { ...alcance, periodo, anuladaEn: null },
          select: {
            profesionalId: true,
            monto: true,
            pagos: true,
            tipo: true,
          },
        }),
        db.liquidacion.findMany({ where: { ...alcance, periodo } }),
        db.turno.groupBy({
          by: ['profesionalId'],
          where: {
            ...alcance,
            ...enElMes,
            estadoAsistencia: EstadoAsistencia.pendiente,
          },
          _count: { _all: true },
        }),
        db.turno.groupBy({
          by: ['profesionalId'],
          where: {
            ...alcance,
            ...enElMes,
            estadoAsistencia: EstadoAsistencia.presente,
            prestacion: { is: null },
          },
          _count: { _all: true },
        }),
      ]);

    const conDatos = new Set([
      ...prestaciones.map((p) => p.profesionalId),
      ...liquidaciones.map((l) => l.profesionalId),
    ]);
    const profesionales = await db.profesional.findMany({
      where: alcance.profesionalId
        ? { id: alcance.profesionalId }
        : { OR: [{ activo: true }, { id: { in: [...conDatos] } }] },
      select: SELECT_PROFESIONAL,
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });
    const ids = profesionales.map((p) => p.id);
    const [acuerdos, turnosEnSala, precio] = await Promise.all([
      db.acuerdoAlquiler.findMany({
        where: { profesionalId: { in: ids }, vigenteDesde: { lte: periodo } },
        orderBy: { vigenteDesde: 'desc' },
      }),
      db.turno.findMany({
        where: {
          ...alcance,
          ...enElMes,
          estadoAsistencia: EstadoAsistencia.presente,
          salaId: { not: null },
        },
        select: { profesionalId: true, inicio: true, fin: true },
      }),
      // Precio particular general vigente al último día del mes ("N sesiones").
      db.precio.findFirst({
        where: {
          pacienteId: null,
          financiadorId: null,
          vigenteDesde: { lte: new Date(`${ultimo}T00:00:00Z`) },
        },
        orderBy: [{ vigenteDesde: 'desc' }, { creadoEn: 'desc' }],
        select: { monto: true },
      }),
    ]);
    const precioSesion = precio?.monto ?? CERO;
    const contar = (
      filas: { profesionalId: string; _count: { _all: number } }[],
    ) => new Map(filas.map((f) => [f.profesionalId, f._count._all]));
    const marcar = contar(sinMarcar);
    const faltan = contar(sinPrestacion);

    return profesionales
      .map((prof) => {
        const suyas = prestaciones.filter((p) => p.profesionalId === prof.id);
        const liq =
          liquidaciones.find((l) => l.profesionalId === prof.id) ?? null;
        const cobrado = sumar(
          suyas.map((p) => cobroDe(p.monto, p.pagos).cobrado),
        );
        const congelada = liq && ESTADOS_CERRADOS.includes(liq.estado as never);
        const { id, nombre, apellido, disciplina } = prof;
        const horasSala = sumar(
          turnosEnSala
            .filter((t) => t.profesionalId === prof.id)
            .map((t) => horasDe(t.inicio, t.fin)),
        );
        let sesiones: number;
        let bruto: Decimal;
        let calculo: ReturnType<typeof calcularAlquiler>;
        let cobraElCentro: boolean;
        let acuerdoUsado: AcuerdoUsado | null;
        if (congelada) {
          const d = (liq.detalleAlquiler ?? null) as DetalleAlquiler | null;
          sesiones = liq.sesiones;
          bruto = liq.totalBruto;
          cobraElCentro = liq.cobraElCentro;
          calculo = {
            alquiler: liq.alquiler,
            componentes: d?.componentes ?? [],
            saldo: liq.totalLiquidado,
          };
          acuerdoUsado = d
            ? {
                id: d.acuerdoId,
                vigenteDesde: d.vigenteDesde,
                nota: d.nota ?? null,
              }
            : null;
        } else {
          const acuerdo =
            acuerdos.find((a) => a.profesionalId === prof.id) ?? null;
          // Faltazos: suman a lo facturado, pero no son sesiones atendidas.
          sesiones = suyas.filter(
            (p) => p.tipo === TipoPrestacion.sesion,
          ).length;
          bruto = sumar(suyas.map((p) => p.monto));
          calculo = calcularAlquiler(acuerdo, {
            facturado: bruto,
            sesiones,
            horasSala,
            precioSesion,
          });
          cobraElCentro = acuerdo?.cobraElCentro ?? true;
          acuerdoUsado = acuerdo && {
            id: acuerdo.id,
            vigenteDesde: mesDe(acuerdo.vigenteDesde),
            nota: acuerdo.nota,
          };
        }
        const faltazos = suyas.filter((p) => p.tipo === TipoPrestacion.faltazo);
        return {
          profesional: { id, nombre, apellido, disciplina },
          sesiones,
          faltazos: faltazos.length,
          montoFaltazos: sumar(faltazos.map((p) => p.monto)),
          bruto,
          cobrado,
          alquiler: calculo.alquiler,
          componentes: calculo.componentes,
          cobraElCentro,
          saldo: calculo.saldo,
          acuerdo: acuerdoUsado,
          liquidacion: liq && {
            id: liq.id,
            estado: liq.estado,
            cerradaEn: liq.cerradaEn,
            pagadaEn: liq.pagadaEn,
          },
          sinMarcar: marcar.get(prof.id) ?? 0,
          sinPrestacion: faltan.get(prof.id) ?? 0,
          bases: {
            horasSala: num(horasSala),
            precioSesion: num(precioSesion),
          },
        } satisfies TotalesProfesional;
      })
      .filter(
        // Sin pedir uno en particular, se omiten los que no tuvieron nada en el mes.
        (t) =>
          !!alcance.profesionalId ||
          t.sesiones > 0 ||
          !!t.liquidacion ||
          t.sinMarcar > 0 ||
          t.sinPrestacion > 0,
      );
  }

  /** Genera y cierra la liquidación del mes (antes crea las prestaciones que falten). */
  async generar(centroId: string, profesionalId: string, mes: string) {
    const db = this.db(centroId);
    const prof = await db.profesional.findUnique({
      where: { id: profesionalId },
      select: { id: true },
    });
    if (!prof) throw new NotFoundException('Profesional no encontrado');
    const periodo = periodoDe(mes);
    const existente = await db.liquidacion.findFirst({
      where: { profesionalId, periodo },
    });
    if (existente && ESTADOS_CERRADOS.includes(existente.estado as never)) {
      throw new ConflictException('La liquidación de ese mes ya está generada');
    }
    await this.prestaciones.generarFaltantes(centroId, mes);
    const [t] = await this.calcular(db, centroId, mes, { profesionalId });
    if (t.sinMarcar) {
      throw new ConflictException(
        t.sinMarcar === 1
          ? 'Queda 1 turno del mes sin asistencia marcada: marcalo antes de liquidar'
          : `Quedan ${t.sinMarcar} turnos del mes sin asistencia marcada: marcalos antes de liquidar`,
      );
    }
    const detalle: DetalleAlquiler = {
      acuerdoId: t.acuerdo?.id ?? null,
      vigenteDesde: t.acuerdo?.vigenteDesde ?? null,
      cobraElCentro: t.cobraElCentro,
      componentes: t.componentes,
      horasSala: t.bases.horasSala,
      precioSesion: t.bases.precioSesion,
      nota: t.acuerdo?.nota ?? null,
    };
    const datos = {
      sesiones: t.sesiones,
      totalBruto: t.bruto,
      alquiler: t.alquiler,
      detalleAlquiler: detalle as unknown as Prisma.InputJsonObject,
      cobraElCentro: t.cobraElCentro,
      totalLiquidado: t.saldo,
      estado: EstadoLiquidacion.cerrada,
      cerradaEn: new Date(),
    };
    if (existente) {
      await db.liquidacion.update({ where: { id: existente.id }, data: datos });
    } else {
      await db.liquidacion.create({
        data: {
          profesionalId,
          periodo,
          ...datos,
        } as Prisma.LiquidacionUncheckedCreateInput,
      });
    }
    const [final] = await this.calcular(db, centroId, mes, { profesionalId });
    return vistaTotales(final);
  }

  async pagar(centroId: string, id: string) {
    return this.cambiarEstado(
      centroId,
      id,
      EstadoLiquidacion.cerrada,
      {
        estado: EstadoLiquidacion.pagada,
        pagadaEn: new Date(),
      },
      'Solo se marca pagada una liquidación cerrada',
    );
  }

  async reabrir(centroId: string, id: string) {
    return this.cambiarEstado(
      centroId,
      id,
      EstadoLiquidacion.cerrada,
      {
        estado: EstadoLiquidacion.borrador,
        cerradaEn: null,
      },
      'Solo se reabre una liquidación cerrada (una pagada no)',
    );
  }

  private async cambiarEstado(
    centroId: string,
    id: string,
    desde: EstadoLiquidacion,
    data: Prisma.LiquidacionUpdateInput,
    error: string,
  ) {
    const db = this.db(centroId);
    const liq = await db.liquidacion.findUnique({ where: { id } });
    if (!liq) throw new NotFoundException('Liquidación no encontrada');
    if (liq.estado !== desde) throw new ConflictException(error);
    await db.liquidacion.update({ where: { id }, data });
    const mes = liq.periodo.toISOString().slice(0, 7);
    const [t] = await this.calcular(db, centroId, mes, {
      profesionalId: liq.profesionalId,
    });
    return vistaTotales(t);
  }

  private db(centroId: string): ClienteDeCentro {
    return this.prisma.paraCentro(centroId);
  }
}

// ───────── Controller ─────────

@ApiTags('liquidaciones')
@ApiBearerAuth()
@RequiereModulo(Modulo.liquidacion)
@Controller('liquidaciones')
export class LiquidacionesController {
  constructor(private readonly liquidaciones: LiquidacionesService) {}

  /** Por profesional: sesiones, facturado, alquiler y saldo. El profesional ve solo la suya. */
  @Get()
  @Roles(Rol.admin, Rol.profesional)
  listar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: mesSchema }) q: z.infer<typeof mesSchema>,
  ) {
    return this.liquidaciones.listar(centroId, quien, q.mes);
  }

  @Post()
  @Roles(Rol.admin)
  @ApiBodyZod(generarLiquidacionSchema)
  generar(
    @CentroActual() centroId: string,
    @Body({ schema: generarLiquidacionSchema })
    dto: z.infer<typeof generarLiquidacionSchema>,
  ) {
    return this.liquidaciones.generar(centroId, dto.profesionalId, dto.mes);
  }

  @Post(':id/pagar')
  @HttpCode(HttpStatus.OK)
  @Roles(Rol.admin)
  pagar(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.liquidaciones.pagar(centroId, id);
  }

  @Post(':id/reabrir')
  @HttpCode(HttpStatus.OK)
  @Roles(Rol.admin)
  reabrir(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.liquidaciones.reabrir(centroId, id);
  }
}

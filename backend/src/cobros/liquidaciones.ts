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
} from '../generated/prisma/client.js';
import type { ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { generarLiquidacionSchema, mesSchema } from './cobros.schemas.js';
import { alcanceDe, ESTADOS_CERRADOS, type DbCobros } from './comun.js';
import { PrestacionesService } from './prestaciones.service.js';
import { cobroDe, liquidar, num, sumar, type Decimal } from './reglas.js';

const SELECT_PROFESIONAL = {
  id: true,
  nombre: true,
  apellido: true,
  disciplina: true,
  activo: true,
  porcentajeLiquidacion: true,
} satisfies Prisma.ProfesionalSelect;

/** Totales de un profesional en un mes, en Decimal (para seguir operando). */
export interface TotalesProfesional {
  profesional: {
    id: string;
    nombre: string;
    apellido: string;
    disciplina: string;
  };
  sesiones: number;
  bruto: Decimal;
  cobrado: Decimal;
  porcentaje: Decimal;
  liquidado: Decimal;
  retencion: Decimal;
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
}

function vistaTotales(t: TotalesProfesional) {
  return {
    profesional: t.profesional,
    sesiones: t.sesiones,
    facturado: num(t.bruto),
    cobrado: num(t.cobrado),
    porcentaje: num(t.porcentaje),
    retencionPorcentaje: num(new Prisma.Decimal(100).minus(t.porcentaje)),
    aLiquidar: num(t.liquidado),
    retencion: num(t.retencion),
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

/**
 * Liquidación mensual por profesional: lo facturado en el mes (sus prestaciones)
 * por su porcentaje. El resto es la retención del centro.
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
          where: { ...alcance, periodo },
          select: { profesionalId: true, monto: true, pagos: true },
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
        let sesiones: number;
        let bruto: Decimal;
        let porcentaje: Decimal;
        let liquidado: Decimal;
        if (congelada) {
          sesiones = liq.sesiones;
          bruto = liq.totalBruto;
          porcentaje = liq.porcentaje;
          liquidado = liq.totalLiquidado;
        } else {
          sesiones = suyas.length;
          bruto = sumar(suyas.map((p) => p.monto));
          porcentaje = prof.porcentajeLiquidacion;
          liquidado = liquidar(bruto, porcentaje).liquidado;
        }
        return {
          profesional: { id, nombre, apellido, disciplina },
          sesiones,
          bruto,
          cobrado,
          porcentaje,
          liquidado,
          retencion: bruto.minus(liquidado),
          liquidacion: liq && {
            id: liq.id,
            estado: liq.estado,
            cerradaEn: liq.cerradaEn,
            pagadaEn: liq.pagadaEn,
          },
          sinMarcar: marcar.get(prof.id) ?? 0,
          sinPrestacion: faltan.get(prof.id) ?? 0,
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
    const datos = {
      sesiones: t.sesiones,
      totalBruto: t.bruto,
      porcentaje: t.porcentaje,
      totalLiquidado: t.liquidado,
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

  /** Por profesional: sesiones, facturado, porcentaje y a liquidar. El profesional ve solo la suya. */
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

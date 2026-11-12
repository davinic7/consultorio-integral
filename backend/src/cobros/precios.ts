import { RequiereModulo } from '../planes/planes.js';
import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CentroActual, Roles } from '../auth/decoradores.js';
import { aFechaSolo, idParam } from '../common/comunes.js';
import { aLocal } from '../common/tiempo.js';
import { ApiBodyZod } from '../common/zod.js';
import { Modulo, Prisma, Rol } from '../generated/prisma/client.js';
import { sinCentro, type ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  crearPrecioSchema,
  listarPreciosSchema,
  type CrearPrecioDto,
} from './cobros.schemas.js';
import { claveMes, mesesCerrados, precioVigente } from './comun.js';
import { num } from './reglas.js';

const dia = (fecha: string) => new Date(`${fecha}T00:00:00Z`);

/**
 * Valor de la sesión por cobertura, con historial (como precios.php de la
 * referencia): un aumento se carga con su fecha de vigencia y no pisa al
 * anterior. Al cargarlo o borrarlo se recalculan las sesiones que todavía no
 * tienen pagos ni factura, de meses sin liquidar y con monto automático.
 */
@Injectable()
export class PreciosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(centroId: string, pacienteId?: string) {
    const db = this.db(centroId);
    const precios = await db.precio.findMany({
      where: { pacienteId: pacienteId ?? null },
      include: { financiador: { select: { id: true, nombre: true } } },
      orderBy: [{ vigenteDesde: 'desc' }, { creadoEn: 'desc' }],
    });
    const hoy = await this.hoy(centroId);
    // El vigente de cada cobertura es el primero (más reciente) que ya empezó.
    const vistos = new Set<string>();
    return precios.map((p) => {
      const desde = aFechaSolo(p.vigenteDesde)!;
      const clave = p.financiadorId ?? 'particular';
      const vigente = desde <= hoy && !vistos.has(clave);
      if (vigente) vistos.add(clave);
      return {
        id: p.id,
        financiador: p.financiador,
        pacienteId: p.pacienteId,
        monto: num(p.monto),
        vigenteDesde: desde,
        vigente,
        futuro: desde > hoy,
      };
    });
  }

  async crear(centroId: string, dto: CrearPrecioDto) {
    const db = this.db(centroId);
    if (dto.financiadorId) {
      const f = await db.financiador.count({
        where: { id: dto.financiadorId },
      });
      if (!f) throw new NotFoundException('Obra social no encontrada');
    }
    if (dto.pacienteId) {
      const p = await db.paciente.count({ where: { id: dto.pacienteId } });
      if (!p) throw new NotFoundException('Paciente no encontrado');
    }
    const precio = await db.precio.create({
      data: sinCentro<Prisma.PrecioUncheckedCreateInput>({
        financiadorId: dto.financiadorId,
        pacienteId: dto.pacienteId ?? null,
        monto: dto.monto,
        vigenteDesde: dia(dto.vigenteDesde),
      }),
    });
    const recalculadas = await this.recalcular(
      db,
      precio.financiadorId,
      precio.pacienteId,
      precio.vigenteDesde,
    );
    return { id: precio.id, recalculadas };
  }

  async borrar(centroId: string, id: string) {
    const db = this.db(centroId);
    const precio = await db.precio.findUnique({ where: { id } });
    if (!precio) throw new NotFoundException('Precio no encontrado');
    await db.precio.delete({ where: { id } });
    const recalculadas = await this.recalcular(
      db,
      precio.financiadorId,
      precio.pacienteId,
      precio.vigenteDesde,
    );
    return { recalculadas };
  }

  /** Vuelve a calcular el monto de las sesiones que alcanza un cambio de precio. */
  private async recalcular(
    db: ClienteDeCentro,
    financiadorId: string | null,
    pacienteId: string | null,
    desde: Date,
  ): Promise<number> {
    const candidatas = await db.prestacion.findMany({
      where: {
        financiadorId,
        ...(pacienteId ? { pacienteId } : {}),
        fecha: { gte: desde },
        montoManual: false,
        facturada: false,
        // Los faltazos guardan el monto de la regla del profesional.
        tipo: 'sesion',
        anuladaEn: null,
        pagos: { none: {} },
      },
      select: {
        id: true,
        pacienteId: true,
        profesionalId: true,
        periodo: true,
        fecha: true,
        monto: true,
      },
    });
    if (!candidatas.length) return 0;
    const cerrados = await mesesCerrados(db, {
      periodo: {
        gte: candidatas.reduce(
          (a, c) => (c.periodo < a ? c.periodo : a),
          candidatas[0].periodo,
        ),
      },
    });
    let cambiadas = 0;
    for (const c of candidatas) {
      if (cerrados.has(claveMes(c.profesionalId, c.periodo))) continue;
      const monto = await precioVigente(
        db,
        c.pacienteId,
        financiadorId,
        c.fecha,
      );
      if (monto.equals(c.monto)) continue;
      await db.prestacion.update({ where: { id: c.id }, data: { monto } });
      cambiadas++;
    }
    return cambiadas;
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

/** Valor de la sesión de cada obra social y de particular. Los ven admin y recepción; los carga el admin. */
@ApiTags('precios')
@ApiBearerAuth()
@RequiereModulo(Modulo.cobros)
@Controller('precios')
export class PreciosController {
  constructor(private readonly precios: PreciosService) {}

  @Get()
  @Roles(Rol.admin, Rol.recepcion)
  listar(
    @CentroActual() centroId: string,
    @Query({ schema: listarPreciosSchema })
    q: z.infer<typeof listarPreciosSchema>,
  ) {
    return this.precios.listar(centroId, q.pacienteId);
  }

  @Post()
  @Roles(Rol.admin)
  @ApiBodyZod(crearPrecioSchema)
  crear(
    @CentroActual() centroId: string,
    @Body({ schema: crearPrecioSchema }) dto: CrearPrecioDto,
  ) {
    return this.precios.crear(centroId, dto);
  }

  @Delete(':id')
  @Roles(Rol.admin)
  borrar(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.precios.borrar(centroId, id);
  }
}

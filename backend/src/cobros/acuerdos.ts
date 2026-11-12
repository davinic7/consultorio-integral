import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { idParam, textoOpcional } from '../common/comunes.js';
import { mesTexto, periodoDe } from '../common/tiempo.js';
import { ApiBodyZod } from '../common/zod.js';
import {
  Modulo,
  Prisma,
  Rol,
  type AcuerdoAlquiler,
} from '../generated/prisma/client.js';
import { RequiereModulo } from '../planes/planes.js';
import { sinCentro, type ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ESTADOS_CERRADOS } from './comun.js';

const monto = z.number().min(0).max(9_999_999_999).multipleOf(0.01);

/**
 * Componentes del acuerdo (null o sin enviar: no se usa). Se suman todos los
 * cargados; sin ninguno, el profesional no paga alquiler.
 */
export const acuerdoSchema = z.object({
  montoFijo: monto.nullable().optional(),
  porcentaje: z.number().min(0).max(100).multipleOf(0.01).nullable().optional(),
  montoPorSesion: monto.nullable().optional(),
  montoPorHora: monto.nullable().optional(),
  sesionesEquivalentes: z.number().int().min(1).max(999).nullable().optional(),
  /** El centro cobra a los pacientes por el profesional (por defecto, sí). */
  cobraElCentro: z.boolean().default(true),
  nota: textoOpcional(200),
});
export type AcuerdoDto = z.infer<typeof acuerdoSchema>;
const mesParam = mesTexto;

const dec = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

function vista(a: AcuerdoAlquiler) {
  return {
    id: a.id,
    /** YYYY-MM desde el que rige. */
    vigenteDesde: a.vigenteDesde.toISOString().slice(0, 7),
    montoFijo: dec(a.montoFijo),
    porcentaje: dec(a.porcentaje),
    montoPorSesion: dec(a.montoPorSesion),
    montoPorHora: dec(a.montoPorHora),
    sesionesEquivalentes: a.sesionesEquivalentes,
    cobraElCentro: a.cobraElCentro,
    nota: a.nota,
    creadoEn: a.creadoEn.toISOString(),
  };
}

/**
 * Acuerdos de alquiler de cada profesional con el centro. Cada uno rige desde un
 * mes hasta que empieza el siguiente. Los meses ya liquidados guardaron su
 * cálculo, y no se puede cargar ni borrar un acuerdo que empiece en un mes que
 * ya tiene la liquidación cerrada o pagada (o antes).
 */
@Injectable()
export class AcuerdosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId: string,
  ) {
    const db = this.db(centroId);
    await this.exigirProfesional(db, quien, profesionalId);
    const acuerdos = await db.acuerdoAlquiler.findMany({
      where: { profesionalId },
      orderBy: { vigenteDesde: 'desc' },
    });
    return acuerdos.map(vista);
  }

  /** Carga (o reemplaza) el acuerdo que rige desde ese mes. */
  async guardar(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId: string,
    mes: string,
    dto: AcuerdoDto,
  ) {
    const db = this.db(centroId);
    await this.exigirProfesional(db, quien, profesionalId);
    const vigenteDesde = periodoDe(mes);
    await this.exigirMesAbierto(db, profesionalId, vigenteDesde);
    const datos = {
      montoFijo: dto.montoFijo ?? null,
      porcentaje: dto.porcentaje ?? null,
      montoPorSesion: dto.montoPorSesion ?? null,
      montoPorHora: dto.montoPorHora ?? null,
      sesionesEquivalentes: dto.sesionesEquivalentes ?? null,
      cobraElCentro: dto.cobraElCentro,
      nota: dto.nota ?? null,
    };
    const a = await db.acuerdoAlquiler.upsert({
      where: {
        centroId_profesionalId_vigenteDesde: {
          centroId,
          profesionalId,
          vigenteDesde,
        },
      },
      create: sinCentro<Prisma.AcuerdoAlquilerUncheckedCreateInput>({
        profesionalId,
        vigenteDesde,
        ...datos,
      }),
      update: datos,
    });
    return vista(a);
  }

  async borrar(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId: string,
    mes: string,
  ) {
    const db = this.db(centroId);
    await this.exigirProfesional(db, quien, profesionalId);
    const vigenteDesde = periodoDe(mes);
    const a = await db.acuerdoAlquiler.findFirst({
      where: { profesionalId, vigenteDesde },
    });
    if (!a) throw new NotFoundException('No hay un acuerdo desde ese mes');
    await this.exigirMesAbierto(db, profesionalId, vigenteDesde);
    await db.acuerdoAlquiler.delete({ where: { id: a.id } });
  }

  // ───────── Internos ─────────

  /** El profesional existe; el rol profesional solo ve los suyos. */
  private async exigirProfesional(
    db: ClienteDeCentro,
    quien: UsuarioAutenticado,
    profesionalId: string,
  ) {
    const p = await db.profesional.findUnique({
      where: { id: profesionalId },
      select: { usuarioId: true },
    });
    if (!p) throw new NotFoundException('Profesional no encontrado');
    if (quien.rol === Rol.profesional && p.usuarioId !== quien.usuarioId)
      throw new ForbiddenException('Solo podés ver tu propio acuerdo');
  }

  private async exigirMesAbierto(
    db: ClienteDeCentro,
    profesionalId: string,
    desde: Date,
  ) {
    const cerrada = await db.liquidacion.findFirst({
      where: {
        profesionalId,
        periodo: { gte: desde },
        estado: { in: ESTADOS_CERRADOS },
      },
      orderBy: { periodo: 'desc' },
      select: { periodo: true },
    });
    if (cerrada) {
      throw new ConflictException(
        `La liquidación de ${cerrada.periodo.toISOString().slice(0, 7)} ya está cerrada: el cambio tiene que regir desde un mes posterior`,
      );
    }
  }

  private db(centroId: string) {
    return this.prisma.paraCentro(centroId);
  }
}

@ApiTags('liquidaciones')
@ApiBearerAuth()
@RequiereModulo(Modulo.liquidacion)
@Controller('profesionales/:profesionalId/acuerdos')
export class AcuerdosController {
  constructor(private readonly acuerdos: AcuerdosService) {}

  /** Historial de acuerdos (el más nuevo primero). El profesional ve los suyos. */
  @Get()
  @Roles(Rol.admin, Rol.profesional)
  listar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('profesionalId', { schema: idParam }) profesionalId: string,
  ) {
    return this.acuerdos.listar(centroId, quien, profesionalId);
  }

  /** Carga o reemplaza el acuerdo que rige desde `mes` (YYYY-MM). */
  @Put(':mes')
  @Roles(Rol.admin)
  @ApiBodyZod(acuerdoSchema)
  guardar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('profesionalId', { schema: idParam }) profesionalId: string,
    @Param('mes', { schema: mesParam }) mes: string,
    @Body({ schema: acuerdoSchema }) dto: AcuerdoDto,
  ) {
    return this.acuerdos.guardar(centroId, quien, profesionalId, mes, dto);
  }

  @Delete(':mes')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Rol.admin)
  async borrar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('profesionalId', { schema: idParam }) profesionalId: string,
    @Param('mes', { schema: mesParam }) mes: string,
  ): Promise<void> {
    await this.acuerdos.borrar(centroId, quien, profesionalId, mes);
  }
}

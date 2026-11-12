import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { idParam } from '../common/comunes.js';
import { ApiBodyZod } from '../common/zod.js';
import {
  ModoFaltazo,
  Modulo,
  Rol,
  type Profesional,
} from '../generated/prisma/client.js';
import { RequiereModulo } from '../planes/planes.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const reglaFaltazoSchema = z
  .object({
    activo: z.boolean(),
    toleranciaHoras: z.number().int().min(0).max(168).default(24),
    modo: z.enum(ModoFaltazo).default(ModoFaltazo.completa),
    /** Obligatorio con modo "fijo". */
    monto: z
      .number()
      .min(0)
      .max(9_999_999_999)
      .multipleOf(0.01)
      .nullable()
      .optional(),
  })
  .refine((r) => r.modo !== ModoFaltazo.fijo || (r.monto ?? null) !== null, {
    message: 'monto: obligatorio con modo "fijo"',
    path: ['monto'],
  });
export type ReglaFaltazoDto = z.infer<typeof reglaFaltazoSchema>;

function vista(p: Profesional) {
  return {
    activo: p.faltazoActivo,
    toleranciaHoras: p.faltazoToleranciaHoras,
    modo: p.faltazoModo,
    monto: p.faltazoMonto?.toNumber() ?? null,
  };
}

/**
 * Regla de faltazo de cada profesional: la decide él (o la administración por
 * él). Apagada por defecto. Al activarla, faltar sin aviso o avisar con menos
 * horas que la tolerancia genera un cobro pendiente al paciente particular
 * (nunca a una obra social), que se puede anular con motivo.
 */
@Injectable()
export class ReglaFaltazoService {
  constructor(private readonly prisma: PrismaService) {}

  async obtener(centroId: string, quien: UsuarioAutenticado, id: string) {
    return vista(await this.propio(centroId, quien, id));
  }

  async guardar(
    centroId: string,
    quien: UsuarioAutenticado,
    id: string,
    dto: ReglaFaltazoDto,
  ) {
    await this.propio(centroId, quien, id);
    const p = await this.prisma.paraCentro(centroId).profesional.update({
      where: { id },
      data: {
        faltazoActivo: dto.activo,
        faltazoToleranciaHoras: dto.toleranciaHoras,
        faltazoModo: dto.modo,
        faltazoMonto: dto.modo === ModoFaltazo.fijo ? dto.monto : null,
      },
    });
    return vista(p);
  }

  /** El profesional solo la suya; la administración, la de cualquiera. */
  private async propio(
    centroId: string,
    quien: UsuarioAutenticado,
    id: string,
  ): Promise<Profesional> {
    const p = await this.prisma
      .paraCentro(centroId)
      .profesional.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Profesional no encontrado');
    if (quien.rol !== Rol.admin && p.usuarioId !== quien.usuarioId)
      throw new ForbiddenException('Solo podés ver y cambiar tu propia regla');
    return p;
  }
}

@ApiTags('profesionales')
@ApiBearerAuth()
@RequiereModulo(Modulo.cobros)
@Roles(Rol.admin, Rol.profesional)
@Controller('profesionales/:id/faltazo')
export class ReglaFaltazoController {
  constructor(private readonly reglas: ReglaFaltazoService) {}

  @Get()
  obtener(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.reglas.obtener(centroId, quien, id);
  }

  @Put()
  @ApiBodyZod(reglaFaltazoSchema)
  guardar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: reglaFaltazoSchema }) dto: ReglaFaltazoDto,
  ) {
    return this.reglas.guardar(centroId, quien, id, dto);
  }
}

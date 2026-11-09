import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { boolQuery, idParam } from '../common/comunes.js';
import { Prisma, Rol, TipoAviso } from '../generated/prisma/client.js';
import { sinCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Roles que reciben los avisos de cambios de agenda. */
export const ROLES_AVISADOS: Rol[] = [Rol.admin, Rol.recepcion];

const listarSchema = z.object({
  soloNoLeidos: boolQuery.optional(),
  limite: z.coerce.number().int().min(1).max(100).default(50),
});

@Injectable()
export class AvisosService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Crea un aviso para cada admin y recepcionista activo del centro (menos el autor).
   * Se llama dentro de la misma operación que el cambio de agenda.
   */
  async avisarCambioDeAgenda(
    centroId: string,
    autorId: string,
    tipo: TipoAviso,
    mensaje: string,
    turnoId: string | null,
  ): Promise<number> {
    const db = this.prisma.paraCentro(centroId);
    const destinatarios = await db.miembro.findMany({
      where: {
        rol: { in: ROLES_AVISADOS },
        activo: true,
        usuarioId: { not: autorId },
      },
      select: { usuarioId: true },
    });
    if (!destinatarios.length) return 0;
    const { count } = await db.aviso.createMany({
      data: destinatarios.map((d) =>
        sinCentro<Prisma.AvisoCreateManyInput>({
          destinatarioId: d.usuarioId,
          autorId,
          tipo,
          mensaje: mensaje.slice(0, 400),
          turnoId,
        }),
      ),
    });
    return count;
  }

  async listar(
    centroId: string,
    usuarioId: string,
    soloNoLeidos = false,
    limite = 50,
  ) {
    const db = this.prisma.paraCentro(centroId);
    const where: Prisma.AvisoWhereInput = {
      destinatarioId: usuarioId,
      ...(soloNoLeidos ? { leidoEn: null } : {}),
    };
    const [items, noLeidos] = await Promise.all([
      db.aviso.findMany({
        where,
        orderBy: { creadoEn: 'desc' },
        take: limite,
        select: {
          id: true,
          tipo: true,
          mensaje: true,
          turnoId: true,
          creadoEn: true,
          leidoEn: true,
          autor: { select: { id: true, nombre: true } },
        },
      }),
      this.contarNoLeidos(centroId, usuarioId),
    ]);
    return { items, noLeidos };
  }

  contarNoLeidos(centroId: string, usuarioId: string): Promise<number> {
    return this.prisma
      .paraCentro(centroId)
      .aviso.count({ where: { destinatarioId: usuarioId, leidoEn: null } });
  }

  async marcarLeido(
    centroId: string,
    usuarioId: string,
    id: string,
  ): Promise<void> {
    const { count } = await this.prisma.paraCentro(centroId).aviso.updateMany({
      where: { id, destinatarioId: usuarioId, leidoEn: null },
      data: { leidoEn: new Date() },
    });
    if (count === 0) {
      const existe = await this.prisma
        .paraCentro(centroId)
        .aviso.count({ where: { id, destinatarioId: usuarioId } });
      if (!existe) throw new NotFoundException('Aviso no encontrado');
    }
  }

  async marcarTodosLeidos(
    centroId: string,
    usuarioId: string,
  ): Promise<number> {
    const { count } = await this.prisma.paraCentro(centroId).aviso.updateMany({
      where: { destinatarioId: usuarioId, leidoEn: null },
      data: { leidoEn: new Date() },
    });
    return count;
  }
}

/** Avisos de la persona logueada en el centro actual. */
@ApiTags('avisos')
@ApiBearerAuth()
@Roles(Rol.admin, Rol.recepcion, Rol.profesional)
@Controller('avisos')
export class AvisosController {
  constructor(private readonly avisos: AvisosService) {}

  @Get()
  listar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: listarSchema }) q: z.infer<typeof listarSchema>,
  ) {
    return this.avisos.listar(
      centroId,
      quien.usuarioId,
      q.soloNoLeidos,
      q.limite,
    );
  }

  @Get('no-leidos')
  async noLeidos(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
  ) {
    return {
      noLeidos: await this.avisos.contarNoLeidos(centroId, quien.usuarioId),
    };
  }

  @Post('leer-todos')
  @HttpCode(HttpStatus.OK)
  async leerTodos(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
  ) {
    return {
      marcados: await this.avisos.marcarTodosLeidos(centroId, quien.usuarioId),
    };
  }

  @Post(':id/leido')
  @HttpCode(HttpStatus.NO_CONTENT)
  async leido(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ): Promise<void> {
    await this.avisos.marcarLeido(centroId, quien.usuarioId, id);
  }
}

@Module({
  controllers: [AvisosController],
  providers: [AvisosService],
  exports: [AvisosService],
})
export class AvisosModule {}

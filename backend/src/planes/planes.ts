import {
  Body,
  Controller,
  Get,
  Global,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  SetMetadata,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { SoloSuperadmin } from '../auth/decoradores.js';
import { idParam } from '../common/comunes.js';
import { ApiBodyZod } from '../common/zod.js';
import { Modulo, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const CLAVE_MODULO = 'plan:modulo';

/**
 * La ruta (o el controller) necesita que el plan del centro incluya este módulo.
 * Lo controla el AuthGuard después del rol; sin el módulo responde 403.
 */
export const RequiereModulo = (modulo: Modulo) =>
  SetMetadata(CLAVE_MODULO, modulo);

export const NOMBRE_MODULO: Record<Modulo, string> = {
  agenda: 'Agenda',
  asistencia: 'Asistencia',
  pacientes: 'Pacientes',
  cobros: 'Cobros',
  liquidacion: 'Liquidación',
  reportes: 'Reportes',
  obras_sociales: 'Obras sociales',
  facturacion_arca: 'Facturación electrónica',
};

/** Cuánto se recuerdan los módulos de un centro antes de volver a leerlos. */
const CACHE_MS = 30_000;

/**
 * Módulos habilitados por el plan de cada centro, con una caché corta para no
 * consultar la base en cada pedido. Un cambio de plan se nota en 30 segundos
 * como mucho (al instante en este proceso, porque se limpia la caché).
 */
@Injectable()
export class ModulosCentro {
  private readonly cache = new Map<
    string,
    { modulos: Set<Modulo>; hasta: number }
  >();

  constructor(private readonly prisma: PrismaService) {}

  async de(centroId: string): Promise<Set<Modulo>> {
    const c = this.cache.get(centroId);
    if (c && c.hasta > Date.now()) return c.modulos;
    const centro = await this.prisma.centro.findUnique({
      where: { id: centroId },
      select: { plan: { select: { modulos: { select: { modulo: true } } } } },
    });
    const modulos = new Set(centro?.plan.modulos.map((m) => m.modulo) ?? []);
    this.cache.set(centroId, { modulos, hasta: Date.now() + CACHE_MS });
    return modulos;
  }

  olvidar(): void {
    this.cache.clear();
  }
}

// ───────── Planes y centros (superadmin) ─────────

const modulos = z.array(z.enum(Modulo)).max(20);

export const crearPlanSchema = z.object({
  codigo: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,30}$/, 'minúsculas, números y guiones'),
  nombre: z.string().trim().min(1).max(80),
  precioMensual: z.number().min(0).max(99_999_999).multipleOf(0.01),
  modulos,
});

export const actualizarPlanSchema = crearPlanSchema
  .omit({ codigo: true })
  .extend({ activo: z.boolean() })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'sin cambios');

export const actualizarCentroSchema = z
  .object({
    nombre: z.string().trim().min(1).max(120),
    /** Código del plan. */
    plan: z.string().trim().min(1).max(30),
    activo: z.boolean(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'sin cambios');

const SELECT_PLAN = {
  id: true,
  codigo: true,
  nombre: true,
  precioMensual: true,
  activo: true,
  modulos: { select: { modulo: true } },
  _count: { select: { centros: true } },
} satisfies Prisma.PlanSelect;

function vistaPlan(p: Prisma.PlanGetPayload<{ select: typeof SELECT_PLAN }>) {
  return {
    id: p.id,
    codigo: p.codigo,
    nombre: p.nombre,
    precioMensual: p.precioMensual.toNumber(),
    activo: p.activo,
    modulos: Object.values(Modulo).filter((m) =>
      p.modulos.some((x) => x.modulo === m),
    ),
    centros: p._count.centros,
  };
}

@Injectable()
export class PlanesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modulos: ModulosCentro,
  ) {}

  async listar() {
    const planes = await this.prisma.plan.findMany({
      select: SELECT_PLAN,
      orderBy: { precioMensual: 'asc' },
    });
    return planes.map(vistaPlan);
  }

  async crear(dto: z.infer<typeof crearPlanSchema>) {
    const plan = await this.prisma.plan.create({
      data: {
        codigo: dto.codigo,
        nombre: dto.nombre,
        precioMensual: dto.precioMensual,
        modulos: {
          create: [...new Set(dto.modulos)].map((modulo) => ({ modulo })),
        },
      },
      select: SELECT_PLAN,
    });
    return vistaPlan(plan);
  }

  async actualizar(id: string, dto: z.infer<typeof actualizarPlanSchema>) {
    const { modulos, ...datos } = dto;
    const plan = await this.prisma.$transaction(async (tx) => {
      if (!(await tx.plan.count({ where: { id } })))
        throw new NotFoundException('Plan no encontrado');
      if (modulos) {
        await tx.planModulo.deleteMany({ where: { planId: id } });
        await tx.planModulo.createMany({
          data: [...new Set(modulos)].map((modulo) => ({ planId: id, modulo })),
        });
      }
      return tx.plan.update({
        where: { id },
        data: datos,
        select: SELECT_PLAN,
      });
    });
    this.modulos.olvidar();
    return vistaPlan(plan);
  }

  async actualizarCentro(
    id: string,
    dto: z.infer<typeof actualizarCentroSchema>,
  ) {
    const data: Prisma.CentroUncheckedUpdateInput = {};
    if (dto.nombre !== undefined) data.nombre = dto.nombre;
    if (dto.activo !== undefined) data.activo = dto.activo;
    if (dto.plan !== undefined) {
      const plan = await this.prisma.plan.findUnique({
        where: { codigo: dto.plan },
        select: { id: true, activo: true },
      });
      if (!plan?.activo)
        throw new NotFoundException(`No existe el plan "${dto.plan}"`);
      data.planId = plan.id;
    }
    if (!(await this.prisma.centro.count({ where: { id } })))
      throw new NotFoundException('Centro no encontrado');
    const centro = await this.prisma.centro.update({
      where: { id },
      data,
      select: {
        id: true,
        nombre: true,
        slug: true,
        activo: true,
        plan: { select: { codigo: true, nombre: true } },
      },
    });
    this.modulos.olvidar();
    return centro;
  }
}

@ApiTags('planes')
@ApiBearerAuth()
@SoloSuperadmin()
@Controller('planes')
export class PlanesController {
  constructor(private readonly planes: PlanesService) {}

  @Get()
  listar() {
    return this.planes.listar();
  }

  @Post()
  @ApiBodyZod(crearPlanSchema)
  crear(
    @Body({ schema: crearPlanSchema }) dto: z.infer<typeof crearPlanSchema>,
  ) {
    return this.planes.crear(dto);
  }

  @Patch(':id')
  @ApiBodyZod(actualizarPlanSchema)
  actualizar(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: actualizarPlanSchema })
    dto: z.infer<typeof actualizarPlanSchema>,
  ) {
    return this.planes.actualizar(id, dto);
  }
}

/** Cambio de plan, nombre o estado de un centro (superadmin). */
@ApiTags('centros')
@ApiBearerAuth()
@SoloSuperadmin()
@Controller('centros')
export class CentrosPlanController {
  constructor(private readonly planes: PlanesService) {}

  @Patch(':id')
  @ApiBodyZod(actualizarCentroSchema)
  actualizar(
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: actualizarCentroSchema })
    dto: z.infer<typeof actualizarCentroSchema>,
  ) {
    return this.planes.actualizarCentro(id, dto);
  }
}

@Global()
@Module({
  controllers: [PlanesController, CentrosPlanController],
  providers: [ModulosCentro, PlanesService],
  exports: [ModulosCentro],
})
export class PlanesModule {}

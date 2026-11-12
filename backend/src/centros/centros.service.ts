import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { z } from 'zod';
import { hashPassword } from '../auth/password.js';
import { email, passwordNueva } from '../common/zod.js';
import { Prisma, Rol } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const crearCentroSchema = z.object({
  nombre: z.string().trim().min(1).max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'solo minúsculas, números y guiones')
    .max(60),
  /** Código del plan, por ejemplo centro-basico o individual-intermedio. */
  plan: z.string().trim().min(1).max(30),
  /** Primer administrador del centro. */
  admin: z.object({
    email,
    nombre: z.string().trim().min(1).max(120),
    /** Obligatoria si el email todavía no tiene cuenta. */
    password: passwordNueva.optional(),
  }),
  /**
   * El administrador también atiende (profesional que trabaja solo): se le crea su
   * ficha de profesional vinculada (sin acuerdo de alquiler: no le debe nada al centro).
   */
  atiende: z
    .object({
      nombre: z.string().trim().min(1).max(80),
      apellido: z.string().trim().min(1).max(80),
      disciplina: z.string().trim().min(1).max(80),
      matricula: z.string().trim().max(40).optional(),
    })
    .optional(),
});
export type CrearCentroDto = z.infer<typeof crearCentroSchema>;

/** Alta y listado de centros: tarea del superadministrador. */
@Injectable()
export class CentrosService {
  constructor(private readonly prisma: PrismaService) {}

  listar() {
    return this.prisma.centro.findMany({
      select: {
        id: true,
        nombre: true,
        slug: true,
        activo: true,
        creadoEn: true,
        plan: { select: { codigo: true, nombre: true } },
        _count: { select: { miembros: true } },
      },
      orderBy: { nombre: 'asc' },
    });
  }

  async crear(dto: CrearCentroDto) {
    const plan = await this.prisma.plan.findUnique({
      where: { codigo: dto.plan },
    });
    if (!plan?.activo)
      throw new BadRequestException(`plan: no existe "${dto.plan}"`);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const centro = await tx.centro.create({
          data: { nombre: dto.nombre, slug: dto.slug, planId: plan.id },
        });
        let admin = await tx.usuario.findUnique({
          where: { email: dto.admin.email },
        });
        if (!admin) {
          if (!dto.admin.password) {
            throw new BadRequestException(
              'admin.password: obligatoria para una cuenta nueva',
            );
          }
          admin = await tx.usuario.create({
            data: {
              email: dto.admin.email,
              nombre: dto.admin.nombre,
              passwordHash: await hashPassword(dto.admin.password),
            },
          });
        }
        // Únicas escrituras directas en modelos de centro: es el centro recién creado en
        // esta misma transacción (el cliente de centro no se puede usar dentro de una).
        await tx.miembro.create({
          data: { centroId: centro.id, usuarioId: admin.id, rol: Rol.admin },
        });
        if (dto.atiende) {
          await tx.profesional.create({
            data: {
              centroId: centro.id,
              usuarioId: admin.id,
              ...dto.atiende,
            },
          });
        }
        return {
          id: centro.id,
          nombre: centro.nombre,
          slug: centro.slug,
          plan: plan.codigo,
        };
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `Ya existe un centro con el slug "${dto.slug}"`,
        );
      }
      throw e;
    }
  }
}

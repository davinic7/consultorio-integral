import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { hashPassword } from '../auth/password.js';
import { sinCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type {
  ActualizarMiembroDto,
  CrearMiembroDto,
} from './usuarios.schemas.js';

const SELECT_MIEMBRO = {
  id: true,
  rol: true,
  activo: true,
  creadoEn: true,
  usuario: { select: { id: true, email: true, nombre: true, activo: true } },
} satisfies Prisma.MiembroSelect;

/** Usuarios del centro (miembros). Todo pasa por el cliente del centro. */
@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  listar(centroId: string) {
    return this.prisma.paraCentro(centroId).miembro.findMany({
      select: SELECT_MIEMBRO,
      orderBy: { usuario: { nombre: 'asc' } },
    });
  }

  /**
   * Suma una persona al centro. Si el email ya tiene cuenta (por ejemplo, trabaja
   * en otro centro), se reutiliza y no se toca su nombre ni su contraseña.
   */
  async crear(centroId: string, dto: CrearMiembroDto) {
    const db = this.prisma.paraCentro(centroId);
    return db.$transaction(async (tx) => {
      let usuario = await tx.usuario.findUnique({
        where: { email: dto.email },
      });
      if (!usuario) {
        if (!dto.password) {
          throw new BadRequestException(
            'password: obligatoria para una cuenta nueva',
          );
        }
        usuario = await tx.usuario.create({
          data: {
            email: dto.email,
            nombre: dto.nombre,
            passwordHash: await hashPassword(dto.password),
          },
        });
      }
      try {
        return await tx.miembro.create({
          data: sinCentro<Prisma.MiembroUncheckedCreateInput>({
            usuarioId: usuario.id,
            rol: dto.rol,
          }),
          select: SELECT_MIEMBRO,
        });
      } catch (e) {
        if (
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ) {
          throw new ConflictException('Esa persona ya es parte del centro');
        }
        throw e;
      }
    });
  }

  async actualizar(
    centroId: string,
    miembroId: string,
    usuarioActualId: string,
    dto: ActualizarMiembroDto,
  ) {
    const db = this.prisma.paraCentro(centroId);
    const miembro = await db.miembro.findUnique({ where: { id: miembroId } });
    if (!miembro)
      throw new NotFoundException('Usuario no encontrado en este centro');
    if (miembro.usuarioId === usuarioActualId) {
      // Evita que un admin se quite el acceso por error y deje el centro sin administración.
      throw new ForbiddenException(
        'No podés cambiar tu propio rol ni desactivarte',
      );
    }
    return db.miembro.update({
      where: { id: miembroId },
      data: { rol: dto.rol, activo: dto.activo },
      select: SELECT_MIEMBRO,
    });
  }
}

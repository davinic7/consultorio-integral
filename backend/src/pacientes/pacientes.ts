import { RequiereModulo } from '../planes/planes.js';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import {
  aFechaSolo,
  fechaSolo,
  idParam,
  listadoSchema,
  textoObligatorio,
  textoOpcional,
  type Pagina,
} from '../common/comunes.js';
import { palabrasDeBusqueda, textoBusquedaPaciente } from '../common/texto.js';
import { ApiBodyZod } from '../common/zod.js';
import { Modulo, Prisma, Rol } from '../generated/prisma/client.js';
import { sinCentro, type ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';

// ───────── Schemas ─────────

const camposPaciente = {
  nombre: textoObligatorio(80),
  apellido: textoObligatorio(80),
  dni: z
    .string()
    .trim()
    .transform((s) => s.replace(/[.\s-]/g, ''))
    .pipe(z.string().regex(/^\d{6,10}$/, 'DNI: solo números (6 a 10 dígitos)'))
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  fechaNacimiento: fechaSolo.nullable().optional(),
  telefono: textoOpcional(30),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email('email inválido').max(160))
    .nullable()
    .optional()
    .or(z.literal('').transform(() => null)),
  responsableNombre: textoOpcional(120),
  responsableTelefono: textoOpcional(30),
  financiadorId: z.uuid().nullable().optional(),
  nroAfiliado: textoOpcional(40),
  tieneCud: z.boolean().optional(),
  cudVencimiento: fechaSolo.nullable().optional(),
};

const cudCoherente = (d: {
  tieneCud?: boolean;
  cudVencimiento?: Date | null;
}) => !(d.tieneCud === false && d.cudVencimiento);

export const crearPacienteSchema = z
  .object({
    ...camposPaciente,
    profesionalIds: z.array(z.uuid()).max(20).optional(),
  })
  .refine(
    (d) => cudCoherente(d) && !(d.cudVencimiento && !d.tieneCud),
    'cudVencimiento: solo si el paciente tiene CUD',
  );
export type CrearPacienteDto = z.infer<typeof crearPacienteSchema>;

export const actualizarPacienteSchema = z
  .object({ ...camposPaciente, activo: z.boolean().optional() })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'sin cambios')
  .refine(cudCoherente, 'cudVencimiento: solo si el paciente tiene CUD');
export type ActualizarPacienteDto = z.infer<typeof actualizarPacienteSchema>;

export const asignarProfesionalesSchema = z.object({
  profesionalIds: z.array(z.uuid()).max(20),
});

export const listarPacientesSchema = listadoSchema.extend({
  profesionalId: z.uuid().optional(),
});
export type ListarPacientesDto = z.infer<typeof listarPacientesSchema>;

const INCLUDE = {
  financiador: {
    select: {
      id: true,
      nombre: true,
      tipo: true,
      maxSesionesSemana: true,
      requiereOrden: true,
      requiereToken: true,
    },
  },
  profesionales: {
    select: {
      profesional: {
        select: { id: true, nombre: true, apellido: true, disciplina: true },
      },
    },
  },
} satisfies Prisma.PacienteInclude;

type PacienteCompleto = Prisma.PacienteGetPayload<{ include: typeof INCLUDE }>;

function vista(p: PacienteCompleto) {
  return {
    id: p.id,
    nombre: p.nombre,
    apellido: p.apellido,
    dni: p.dni,
    fechaNacimiento: aFechaSolo(p.fechaNacimiento),
    telefono: p.telefono,
    email: p.email,
    responsableNombre: p.responsableNombre,
    responsableTelefono: p.responsableTelefono,
    financiador: p.financiador,
    nroAfiliado: p.nroAfiliado,
    tieneCud: p.tieneCud,
    cudVencimiento: aFechaSolo(p.cudVencimiento),
    activo: p.activo,
    profesionales: p.profesionales.map((pp) => pp.profesional),
  };
}
export type PacienteVista = ReturnType<typeof vista>;

/** Filtro de búsqueda: cada palabra debe aparecer (sin importar tildes ni mayúsculas). */
export function filtroBusqueda(
  q: string | undefined,
): Prisma.PacienteWhereInput {
  const palabras = palabrasDeBusqueda(q);
  if (!palabras.length) return {};
  return { AND: palabras.map((p) => ({ busqueda: { contains: p } })) };
}

// ───────── Servicio ─────────

/**
 * Pacientes del centro. Admin y recepción ven y gestionan todos; un profesional
 * solo ve los pacientes que tiene asignados.
 */
@Injectable()
export class PacientesService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(
    centroId: string,
    quien: UsuarioAutenticado,
    dto: ListarPacientesDto,
  ): Promise<Pagina<PacienteVista>> {
    const db = this.prisma.paraCentro(centroId);
    const where: Prisma.PacienteWhereInput = {
      AND: [
        await this.alcance(db, quien),
        dto.incluirInactivos ? {} : { activo: true },
        dto.profesionalId
          ? { profesionales: { some: { profesionalId: dto.profesionalId } } }
          : {},
        filtroBusqueda(dto.q),
      ],
    };
    const [items, total] = await Promise.all([
      db.paciente.findMany({
        where,
        include: INCLUDE,
        orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
        skip: (dto.pagina - 1) * dto.porPagina,
        take: dto.porPagina,
      }),
      db.paciente.count({ where }),
    ]);
    return {
      items: items.map(vista),
      total,
      pagina: dto.pagina,
      porPagina: dto.porPagina,
    };
  }

  async obtener(centroId: string, id: string, quien: UsuarioAutenticado) {
    const db = this.prisma.paraCentro(centroId);
    const p = await db.paciente.findFirst({
      where: { AND: [{ id }, await this.alcance(db, quien)] },
      include: INCLUDE,
    });
    if (!p) throw new NotFoundException('Paciente no encontrado');
    return vista(p);
  }

  async crear(centroId: string, dto: CrearPacienteDto) {
    const { profesionalIds = [], ...datos } = dto;
    const db = this.prisma.paraCentro(centroId);
    await this.validarProfesionales(db, profesionalIds);
    await this.validarFinanciador(db, datos.financiadorId);
    const p = await db.$transaction(async (tx) => {
      const creado = await tx.paciente.create({
        data: sinCentro<Prisma.PacienteUncheckedCreateInput>({
          ...datos,
          busqueda: textoBusquedaPaciente(datos),
        }),
      });
      if (profesionalIds.length) {
        await tx.pacienteProfesional.createMany({
          data: profesionalIds.map((profesionalId) =>
            sinCentro<Prisma.PacienteProfesionalCreateManyInput>({
              pacienteId: creado.id,
              profesionalId,
            }),
          ),
        });
      }
      return tx.paciente.findUniqueOrThrow({
        where: { id: creado.id },
        include: INCLUDE,
      });
    });
    return vista(p);
  }

  async actualizar(centroId: string, id: string, dto: ActualizarPacienteDto) {
    const db = this.prisma.paraCentro(centroId);
    const actual = await db.paciente.findUnique({ where: { id } });
    if (!actual) throw new NotFoundException('Paciente no encontrado');
    if (dto.financiadorId && dto.financiadorId !== actual.financiadorId) {
      await this.validarFinanciador(db, dto.financiadorId);
    }

    const datos: Prisma.PacienteUncheckedUpdateInput = {
      ...dto,
      busqueda: textoBusquedaPaciente({
        nombre: dto.nombre ?? actual.nombre,
        apellido: dto.apellido ?? actual.apellido,
        dni: dto.dni !== undefined ? dto.dni : actual.dni,
        telefono: dto.telefono !== undefined ? dto.telefono : actual.telefono,
      }),
    };
    const tieneCud = dto.tieneCud ?? actual.tieneCud;
    if (!tieneCud) {
      if (dto.cudVencimiento) {
        throw new BadRequestException(
          'cudVencimiento: solo si el paciente tiene CUD',
        );
      }
      datos.cudVencimiento = null;
    }
    const p = await db.paciente.update({
      where: { id },
      data: datos,
      include: INCLUDE,
    });
    return vista(p);
  }

  /** Reemplaza la lista de profesionales que atienden al paciente. */
  async asignarProfesionales(
    centroId: string,
    id: string,
    profesionalIds: string[],
  ) {
    const db = this.prisma.paraCentro(centroId);
    const ids = [...new Set(profesionalIds)];
    if (!(await db.paciente.count({ where: { id } }))) {
      throw new NotFoundException('Paciente no encontrado');
    }
    await this.validarProfesionales(db, ids);
    await db.$transaction(async (tx) => {
      await tx.pacienteProfesional.deleteMany({
        where: { pacienteId: id, profesionalId: { notIn: ids } },
      });
      await tx.pacienteProfesional.createMany({
        data: ids.map((profesionalId) =>
          sinCentro<Prisma.PacienteProfesionalCreateManyInput>({
            pacienteId: id,
            profesionalId,
          }),
        ),
        skipDuplicates: true,
      });
    });
  }

  /** Para un profesional, restringe a sus pacientes; para admin y recepción, sin filtro. */
  private async alcance(
    db: ClienteDeCentro,
    quien: UsuarioAutenticado,
  ): Promise<Prisma.PacienteWhereInput> {
    if (quien.rol !== Rol.profesional) return {};
    const yo = await db.profesional.findFirst({
      where: { usuarioId: quien.usuarioId },
      select: { id: true },
    });
    if (!yo) return { id: { in: [] } };
    return { profesionales: { some: { profesionalId: yo.id } } };
  }

  private async validarFinanciador(
    db: ClienteDeCentro,
    id: string | null | undefined,
  ) {
    if (!id) return;
    if (!(await db.financiador.count({ where: { id, activo: true } }))) {
      throw new BadRequestException(
        'financiadorId: no existe o está dado de baja',
      );
    }
  }

  private async validarProfesionales(db: ClienteDeCentro, ids: string[]) {
    if (!ids.length) return;
    const encontrados = await db.profesional.count({
      where: { id: { in: ids }, activo: true },
    });
    if (encontrados !== new Set(ids).size) {
      throw new BadRequestException(
        'profesionalIds: alguno no existe o está inactivo',
      );
    }
  }
}

// ───────── Controller ─────────

@ApiTags('pacientes')
@ApiBearerAuth()
@RequiereModulo(Modulo.pacientes)
@Controller('pacientes')
export class PacientesController {
  constructor(private readonly pacientes: PacientesService) {}

  @Get()
  @Roles(Rol.admin, Rol.recepcion, Rol.profesional)
  listar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: listarPacientesSchema }) q: ListarPacientesDto,
  ) {
    return this.pacientes.listar(centroId, quien, q);
  }

  @Get(':id')
  @Roles(Rol.admin, Rol.recepcion, Rol.profesional)
  obtener(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ) {
    return this.pacientes.obtener(centroId, id, quien);
  }

  @Post()
  @Roles(Rol.admin, Rol.recepcion)
  @ApiBodyZod(crearPacienteSchema)
  crear(
    @CentroActual() centroId: string,
    @Body({ schema: crearPacienteSchema }) dto: CrearPacienteDto,
  ) {
    return this.pacientes.crear(centroId, dto);
  }

  @Patch(':id')
  @Roles(Rol.admin, Rol.recepcion)
  @ApiBodyZod(actualizarPacienteSchema)
  actualizar(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: actualizarPacienteSchema }) dto: ActualizarPacienteDto,
  ) {
    return this.pacientes.actualizar(centroId, id, dto);
  }

  @Put(':id/profesionales')
  @Roles(Rol.admin, Rol.recepcion)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBodyZod(asignarProfesionalesSchema)
  async asignarProfesionales(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: asignarProfesionalesSchema })
    dto: z.infer<typeof asignarProfesionalesSchema>,
  ): Promise<void> {
    await this.pacientes.asignarProfesionales(centroId, id, dto.profesionalIds);
  }
}

@Module({ controllers: [PacientesController], providers: [PacientesService] })
export class PacientesModule {}

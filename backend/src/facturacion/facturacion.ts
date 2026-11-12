import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
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
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { cobroDe, num, sumar, type Decimal } from '../cobros/reglas.js';
import {
  aFechaSolo,
  boolQuery,
  idParam,
  textoOpcional,
} from '../common/comunes.js';
import {
  aLocal,
  diasDelMes,
  fechaTexto,
  mesTexto,
  periodoDe,
  sumarDias,
} from '../common/tiempo.js';
import { ApiBodyZod } from '../common/zod.js';
import {
  EstadoFactura,
  ModoArca,
  Modulo,
  Prisma,
  Rol,
  TipoPrestacion,
  type ConfigFiscal,
} from '../generated/prisma/client.js';
import { CifradoService } from '../notas/cifrado.js';
import { ModulosCentro, RequiereModulo } from '../planes/planes.js';
import { sinCentro, type ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ClienteArca,
  generarCsr,
  leerCertificado,
  type ResultadoFactura,
  type Transporte,
} from './arca.js';
import { pdfFactura } from './pdf.js';

// ───────── Schemas ─────────

export const configSchema = z.object({
  cuit: z
    .string()
    .transform((s) => s.replace(/\D/g, ''))
    .pipe(z.string().regex(/^\d{11}$/, 'el CUIT tiene 11 dígitos'))
    .nullable()
    .optional(),
  razonSocial: textoOpcional(120),
  domicilio: textoOpcional(200),
  inicioActividades: fechaTexto.nullable().optional(),
  ptoVta: z.number().int().min(1).max(99998).optional(),
  modo: z.enum(ModoArca).optional(),
  textoItem: z.string().trim().min(1).max(200).optional(),
  /** Solo en los datos del centro: cada profesional factura con su propio CUIT. */
  facturaCadaProfesional: z.boolean().optional(),
});
const certificadoSchema = z.object({
  certificado: z.string().min(100).max(20_000),
});
const emitirSchema = z.object({
  mes: mesTexto,
  pacienteIds: z.array(z.uuid()).min(1).max(300),
  /** Sumar los faltazos cobrados a la factura (lo decide quien factura). */
  incluirFaltazos: z.boolean().default(false),
  /** Emisor, si factura cada profesional (un profesional lo omite: es él). */
  profesionalId: z.uuid().optional(),
});
/** Emisor: sin profesionalId, el centro (o, para un profesional, él mismo). */
const emisorSchema = z.object({ profesionalId: z.uuid().optional() });
const mesSchema = z.object({
  mes: mesTexto,
  profesionalId: z.uuid().optional(),
  /** En pendientes: sumar los faltazos cobrados al total a facturar. */
  incluirFaltazos: boolQuery.optional(),
});
/** Descripción del ítem de un faltazo en la factura. */
const TEXTO_FALTAZO = 'Sesión no asistida (faltazo)';
const enviadaSchema = z.object({ enviada: z.boolean() });

const CONTEXTO_CLAVE = 'arca-clave';
const dia = (f: string) => new Date(`${f}T00:00:00Z`);

/** Ítems de la factura: sesiones agrupadas por precio. */
function agrupar(montos: Decimal[]) {
  const porPrecio = new Map<string, number>();
  for (const m of montos)
    porPrecio.set(m.toFixed(2), (porPrecio.get(m.toFixed(2)) ?? 0) + 1);
  return [...porPrecio.entries()].map(([precio, cantidad]) => ({
    cantidad,
    precio: Number(precio),
  }));
}

// ───────── Servicio ─────────

/** Quién emite: los datos fiscales y, si factura un profesional, cuál. */
interface Emisor {
  config: ConfigFiscal;
  /** null: factura el centro. */
  profesionalId: string | null;
}

/**
 * Factura electrónica C (monotributo) con ARCA, portado de facturacion.php: por
 * mes, una factura por paciente particular con las sesiones ya cobradas y sin
 * facturar.
 *
 * Emisor: el centro con sus datos fiscales, o, si el centro lo elige
 * (facturaCadaProfesional), cada profesional con su CUIT y su certificado por las
 * sesiones que atendió. El profesional carga sus datos y emite sus facturas; admin
 * y recepción pueden hacerlo por él.
 */
@Injectable()
export class FacturacionService {
  /** Para los tests: reemplaza la conexión con ARCA. */
  transporte?: Transporte;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cifrado: CifradoService,
    private readonly modulos: ModulosCentro,
  ) {}

  /** Datos fiscales del emisor (para un profesional, los suyos). */
  async config(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId?: string,
  ) {
    const centro = await this.configCentro(centroId);
    const e = await this.emisorDatos(centroId, quien, profesionalId, centro);
    return this.vistaConfig(e.config, centro);
  }

  /** Profesionales del centro y si ya cargaron sus datos fiscales (admin y recepción). */
  async emisores(centroId: string) {
    const profesionales = await this.db(centroId).profesional.findMany({
      where: { activo: true },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        disciplina: true,
        configFiscal: {
          select: { cuit: true, modo: true, certificado: true },
        },
      },
      orderBy: [{ apellido: 'asc' }, { nombre: 'asc' }],
    });
    return profesionales.map(({ configFiscal: c, ...p }) => ({
      profesional: p,
      cuit: c?.cuit ?? null,
      modo: c?.modo ?? ModoArca.simulado,
      tieneCertificado: !!c?.certificado,
    }));
  }

  async guardarConfig(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId: string | undefined,
    dto: z.infer<typeof configSchema>,
  ) {
    const centro = await this.configCentro(centroId);
    const e = await this.emisorDatos(centroId, quien, profesionalId, centro);
    if (quien.rol === Rol.recepcion)
      throw new ForbiddenException('Recepción no cambia datos fiscales');
    const { facturaCadaProfesional, ...resto } = dto;
    if (facturaCadaProfesional !== undefined) {
      if (e.profesionalId || quien.rol !== Rol.admin) {
        throw new BadRequestException(
          'facturaCadaProfesional: se elige en los datos del centro',
        );
      }
      if (
        facturaCadaProfesional &&
        !(await this.porProfesionalHabilitado(centroId))
      ) {
        throw new ForbiddenException(
          'Tu plan no incluye la facturación de cada profesional con su CUIT',
        );
      }
    }
    const datos = {
      ...resto,
      ...(facturaCadaProfesional !== undefined
        ? { facturaCadaProfesional }
        : {}),
      ...(dto.inicioActividades !== undefined
        ? {
            inicioActividades: dto.inicioActividades
              ? dia(dto.inicioActividades)
              : null,
          }
        : {}),
    };
    const c = await this.db(centroId).configFiscal.update({
      where: { id: e.config.id },
      data: {
        ...datos,
        ...(dto.modo
          ? { ticketToken: null, ticketSign: null, ticketVence: null }
          : {}),
      },
    });
    return this.vistaConfig(
      c,
      e.profesionalId ? centro : await this.conPlan(centroId, c),
    );
  }

  /** Genera la clave privada (queda cifrada en la base) y devuelve el pedido de certificado. */
  async pedirCertificado(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId?: string,
  ) {
    const { config: c } = await this.emisorEditable(
      centroId,
      quien,
      profesionalId,
    );
    if (!c.cuit) throw new BadRequestException('Primero guardá el CUIT');
    const { clavePem, csrPem } = generarCsr(c.cuit, c.razonSocial ?? '');
    await this.db(centroId).configFiscal.update({
      where: { id: c.id },
      data: {
        clavePrivada: await this.cifrado.cifrarDato(
          centroId,
          clavePem,
          CONTEXTO_CLAVE,
        ),
        certificado: null,
        certificadoVence: null,
        ticketToken: null,
        ticketSign: null,
        ticketVence: null,
      },
    });
    return { csr: csrPem };
  }

  async guardarCertificado(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId: string | undefined,
    pem: string,
  ) {
    const centro = await this.configCentro(centroId);
    const { config: c } = await this.emisorEditable(
      centroId,
      quien,
      profesionalId,
      centro,
    );
    const clave = c.clavePrivada
      ? await this.cifrado.descifrarDato(
          centroId,
          c.clavePrivada,
          CONTEXTO_CLAVE,
        )
      : null;
    if (!clave)
      throw new BadRequestException(
        'Primero generá el pedido de certificado desde acá',
      );
    const info = leerCertificado(pem.trim(), clave);
    if (!info)
      throw new BadRequestException('El archivo no es un certificado válido');
    if (!info.coincide)
      throw new BadRequestException(
        'El certificado no corresponde a la clave generada acá',
      );
    const act = await this.db(centroId).configFiscal.update({
      where: { id: c.id },
      data: {
        certificado: pem.trim(),
        certificadoVence: info.vence,
        ticketToken: null,
        ticketSign: null,
        ticketVence: null,
      },
    });
    return this.vistaConfig(act, act.profesionalId ? centro : act);
  }

  /** Prueba la conexión: el estado de los servidores y el último número del punto de venta. */
  async probar(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId?: string,
  ) {
    const { config: c } = await this.emisorDatos(
      centroId,
      quien,
      profesionalId,
    );
    if (c.modo === ModoArca.simulado)
      return { ok: true, mensaje: 'Modo simulado: no se conecta con ARCA.' };
    const cliente = await this.cliente(centroId, c);
    const servidores = await cliente.dummy();
    const ultimo = await cliente.ultimoComprobante(11);
    return {
      ok: true,
      mensaje: `${servidores}. Última Factura C del punto de venta ${c.ptoVta}: ${ultimo}.`,
    };
  }

  /** Sesiones particulares cobradas y sin factura del mes, por paciente. */
  async pendientes(
    centroId: string,
    quien: UsuarioAutenticado,
    mes: string,
    profesionalId?: string,
    incluirFaltazos = false,
  ) {
    const e = await this.emisorParaFacturar(centroId, quien, profesionalId);
    return this.pendientesDe(centroId, mes, e, incluirFaltazos);
  }

  /**
   * Por paciente: sesiones cobradas sin facturar y, aparte, los faltazos
   * cobrados. Los faltazos se suman a la factura solo si se pide.
   */
  private async pendientesDe(
    centroId: string,
    mes: string,
    e: Emisor,
    incluirFaltazos = false,
  ) {
    const filas = await this.db(centroId).prestacion.findMany({
      where: {
        periodo: periodoDe(mes),
        financiadorId: null,
        facturaId: null,
        anuladaEn: null,
        ...(e.profesionalId ? { profesionalId: e.profesionalId } : {}),
      },
      include: {
        pagos: true,
        paciente: {
          select: { id: true, nombre: true, apellido: true, dni: true },
        },
      },
      orderBy: { fecha: 'asc' },
    });
    const porPaciente = new Map<
      string,
      {
        paciente: (typeof filas)[number]['paciente'];
        cobradas: typeof filas;
        faltazos: typeof filas;
        impagas: number;
      }
    >();
    for (const p of filas) {
      const g = porPaciente.get(p.pacienteId) ?? {
        paciente: p.paciente,
        cobradas: [],
        faltazos: [],
        impagas: 0,
      };
      porPaciente.set(p.pacienteId, g);
      if (cobroDe(p.monto, p.pagos).estado !== 'cobrada') g.impagas++;
      else if (p.tipo === TipoPrestacion.faltazo) g.faltazos.push(p);
      else g.cobradas.push(p);
    }
    return [...porPaciente.values()]
      .sort((a, b) => a.paciente.apellido.localeCompare(b.paciente.apellido))
      .map((g) => {
        const facturables = incluirFaltazos
          ? [...g.cobradas, ...g.faltazos]
          : g.cobradas;
        return {
          paciente: g.paciente,
          sesiones: g.cobradas.length,
          /** Faltazos cobrados sin facturar (se suman solo si se pide). */
          faltazos: g.faltazos.length,
          totalFaltazos: num(sumar(g.faltazos.map((p) => p.monto))),
          prestacionIds: facturables.map((p) => p.id),
          items: agrupar(g.cobradas.map((p) => p.monto)),
          itemsFaltazos: incluirFaltazos
            ? agrupar(g.faltazos.map((p) => p.monto))
            : [],
          total: num(sumar(facturables.map((p) => p.monto))),
          impagas: g.impagas,
          sinDni: !g.paciente.dni,
        };
      });
  }

  /** Emite una factura por paciente elegido. Si ARCA no responde, corta ahí. */
  async emitir(
    centroId: string,
    quien: UsuarioAutenticado,
    mes: string,
    pacienteIds: string[],
    profesionalId?: string,
    incluirFaltazos = false,
  ) {
    const e = await this.emisorParaFacturar(centroId, quien, profesionalId);
    const c = e.config;
    if (c.modo !== ModoArca.simulado && (!c.cuit || !c.razonSocial)) {
      throw new ConflictException(
        e.profesionalId
          ? 'Completá el CUIT y la razón social del profesional'
          : 'Completá el CUIT y la razón social del centro',
      );
    }
    const cliente =
      c.modo === ModoArca.simulado ? null : await this.cliente(centroId, c);
    const zona = await this.zona(centroId);
    const hoy = aLocal(new Date(), zona).fecha;
    const { primero, ultimo } = diasDelMes(mes);
    const elegidos = (
      await this.pendientesDe(centroId, mes, e, incluirFaltazos)
    ).filter(
      (g) => g.prestacionIds.length > 0 && pacienteIds.includes(g.paciente.id),
    );
    const resultados: {
      pacienteId: string;
      ok: boolean;
      facturaId?: string;
      error?: string;
    }[] = [];
    for (const g of elegidos) {
      const doc = (g.paciente.dni ?? '').replace(/\D/g, '');
      let r: ResultadoFactura;
      try {
        r = cliente
          ? await cliente.emitirFacturaC({
              dni: doc || null,
              total: g.total,
              fecha: hoy,
              desde: primero,
              hasta: ultimo,
              vencePago: hoy,
            })
          : await this.simular(centroId, c, hoy);
      } catch (err) {
        resultados.push({
          pacienteId: g.paciente.id,
          ok: false,
          error: (err as Error).message,
        });
        break;
      }
      const factura = await this.db(centroId).$transaction(async (tx) => {
        const f = await tx.factura.create({
          data: sinCentro<Prisma.FacturaUncheckedCreateInput>({
            pacienteId: g.paciente.id,
            configFiscalId: c.id,
            profesionalId: e.profesionalId,
            periodo: periodoDe(mes),
            fecha: dia(hoy),
            ptoVta: c.ptoVta,
            cbteTipo: 11,
            numero: r.ok ? r.numero : null,
            docTipo: doc ? 96 : 99,
            docNro: doc || '0',
            total: g.total,
            detalle: [
              ...g.items.map((it) => ({ descripcion: c.textoItem, ...it })),
              ...g.itemsFaltazos.map((it) => ({
                descripcion: TEXTO_FALTAZO,
                ...it,
              })),
            ],
            cae: r.ok ? r.cae : null,
            caeVence: r.ok ? dia(r.caeVence) : null,
            modo: c.modo,
            estado: r.ok ? EstadoFactura.emitida : EstadoFactura.rechazada,
            error: (r.ok ? r.observaciones : r.error)?.slice(0, 1000) ?? null,
          }),
        });
        if (r.ok) {
          await tx.prestacion.updateMany({
            where: { id: { in: g.prestacionIds }, facturaId: null },
            data: { facturaId: f.id, facturada: true },
          });
        }
        return f;
      });
      resultados.push(
        r.ok
          ? { pacienteId: g.paciente.id, ok: true, facturaId: factura.id }
          : { pacienteId: g.paciente.id, ok: false, error: r.error },
      );
    }
    return {
      emitidas: resultados.filter((x) => x.ok).length,
      resultados,
    };
  }

  async listar(
    centroId: string,
    quien: UsuarioAutenticado,
    mes: string,
    profesionalId?: string,
  ) {
    const filtro = await this.filtroFacturas(centroId, quien, profesionalId);
    const facturas = await this.db(centroId).factura.findMany({
      where: { periodo: periodoDe(mes), ...filtro },
      include: {
        paciente: {
          select: { id: true, nombre: true, apellido: true, telefono: true },
        },
        profesional: { select: { id: true, nombre: true, apellido: true } },
        _count: { select: { prestaciones: true } },
      },
      orderBy: [{ creadaEn: 'desc' }],
    });
    return facturas.map((f) => ({
      id: f.id,
      paciente: f.paciente,
      profesional: f.profesional,
      numero: f.numero,
      ptoVta: f.ptoVta,
      fecha: aFechaSolo(f.fecha)!,
      total: num(f.total),
      sesiones: f._count.prestaciones,
      cae: f.cae,
      caeVence: aFechaSolo(f.caeVence),
      modo: f.modo,
      estado: f.estado,
      error: f.error,
      enviada: f.enviada,
    }));
  }

  async marcarEnviada(
    centroId: string,
    quien: UsuarioAutenticado,
    id: string,
    enviada: boolean,
  ) {
    const filtro = await this.filtroFacturas(centroId, quien);
    const r = await this.db(centroId).factura.updateMany({
      where: { id, ...filtro },
      data: { enviada },
    });
    if (!r.count) throw new NotFoundException('Factura no encontrada');
    return { enviada };
  }

  async pdf(
    centroId: string,
    quien: UsuarioAutenticado,
    id: string,
  ): Promise<{ nombre: string; datos: Buffer }> {
    const filtro = await this.filtroFacturas(centroId, quien);
    const f = await this.db(centroId).factura.findFirst({
      where: { id, ...filtro },
      include: {
        paciente: { select: { nombre: true, apellido: true } },
        emisor: true,
      },
    });
    if (!f || f.estado !== EstadoFactura.emitida)
      throw new NotFoundException('Factura no encontrada');
    const c = f.emisor;
    const periodo = aFechaSolo(f.periodo)!.slice(0, 7);
    const { primero, ultimo } = diasDelMes(periodo);
    const items =
      (f.detalle as {
        descripcion: string;
        cantidad: number;
        precio: number;
      }[]) ?? [];
    const datos = await pdfFactura({
      emisor: {
        razonSocial: c.razonSocial ?? 'Razón social sin cargar',
        cuit: c.cuit ?? '00000000000',
        domicilio: c.domicilio ?? null,
        inicioActividades: aFechaSolo(c.inicioActividades ?? null),
      },
      receptor: {
        nombre: `${f.paciente.apellido}, ${f.paciente.nombre}`,
        docTipo: f.docTipo,
        docNro: f.docNro,
      },
      ptoVta: f.ptoVta,
      numero: f.numero!,
      fecha: aFechaSolo(f.fecha)!,
      desde: primero,
      hasta: ultimo,
      items,
      total: num(f.total),
      cae: f.cae!,
      caeVence: aFechaSolo(f.caeVence)!,
      sinValidez: f.modo !== ModoArca.produccion,
    });
    const nro = `${String(f.ptoVta).padStart(5, '0')}-${String(f.numero).padStart(8, '0')}`;
    return { nombre: `factura-C-${nro}.pdf`, datos };
  }

  // ───────── Internos ─────────

  /** Datos fiscales del centro; sin cargar, se crean con los valores por defecto. */
  /**
   * Datos fiscales del centro; sin cargar, se crean con los valores por defecto.
   * Si el plan no incluye ARCA por profesional, factura el centro aunque la opción
   * haya quedado guardada (por ejemplo, después de bajar de plan).
   */
  private async configCentro(centroId: string): Promise<ConfigFiscal> {
    return this.conPlan(centroId, await this.configCentroGuardada(centroId));
  }

  private async conPlan(
    centroId: string,
    c: ConfigFiscal,
  ): Promise<ConfigFiscal> {
    if (!c.facturaCadaProfesional) return c;
    return (await this.porProfesionalHabilitado(centroId))
      ? c
      : { ...c, facturaCadaProfesional: false };
  }

  private async porProfesionalHabilitado(centroId: string): Promise<boolean> {
    return (await this.modulos.de(centroId)).has(Modulo.arca_por_profesional);
  }

  private async configCentroGuardada(centroId: string): Promise<ConfigFiscal> {
    const db = this.db(centroId);
    const c = await db.configFiscal.findFirst({
      where: { profesionalId: null },
    });
    if (c) return c;
    try {
      return await db.configFiscal.create({
        data: sinCentro<Prisma.ConfigFiscalUncheckedCreateInput>({}),
      });
    } catch (e) {
      // Dos pedidos a la vez: el otro ya la creó (índice único parcial).
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        return db.configFiscal.findFirstOrThrow({
          where: { profesionalId: null },
        });
      }
      throw e;
    }
  }

  /** Ficha de profesional de quien pide (rol profesional). */
  private async miProfesional(
    centroId: string,
    quien: UsuarioAutenticado,
  ): Promise<string> {
    const yo = await this.db(centroId).profesional.findFirst({
      where: { usuarioId: quien.usuarioId, activo: true },
      select: { id: true },
    });
    if (!yo)
      throw new ForbiddenException(
        'Tu cuenta no está vinculada a una ficha de profesional',
      );
    return yo.id;
  }

  /**
   * Emisor cuyos datos se leen o cambian. Un profesional solo ve los suyos, y
   * solo si en el centro factura cada profesional.
   */
  private async emisorDatos(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId?: string,
    centro?: ConfigFiscal,
  ): Promise<Emisor> {
    const cfgCentro = centro ?? (await this.configCentro(centroId));
    let id = profesionalId ?? null;
    if (quien.rol === Rol.profesional) {
      if (!cfgCentro.facturaCadaProfesional) {
        throw new ForbiddenException(
          'En este centro factura el centro, no cada profesional',
        );
      }
      const yo = await this.miProfesional(centroId, quien);
      if (id && id !== yo)
        throw new ForbiddenException('Solo podés ver tus datos fiscales');
      id = yo;
    }
    if (!id) return { config: cfgCentro, profesionalId: null };
    return {
      config: await this.configProfesional(centroId, id),
      profesionalId: id,
    };
  }

  /** Como emisorDatos, pero para cambiar la clave o el certificado (no recepción). */
  private async emisorEditable(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId?: string,
    centro?: ConfigFiscal,
  ): Promise<Emisor> {
    if (quien.rol === Rol.recepcion)
      throw new ForbiddenException('Recepción no cambia datos fiscales');
    return this.emisorDatos(centroId, quien, profesionalId, centro);
  }

  /**
   * Emisor de las facturas: el centro, o el profesional si factura cada uno (en
   * ese caso admin y recepción tienen que decir cuál).
   */
  private async emisorParaFacturar(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId?: string,
  ): Promise<Emisor> {
    const centro = await this.configCentro(centroId);
    if (!centro.facturaCadaProfesional) {
      if (quien.rol === Rol.profesional) {
        throw new ForbiddenException(
          'En este centro factura el centro, no cada profesional',
        );
      }
      if (profesionalId) {
        throw new BadRequestException(
          'profesionalId: en este centro factura el centro',
        );
      }
      return { config: centro, profesionalId: null };
    }
    if (quien.rol !== Rol.profesional && !profesionalId) {
      throw new BadRequestException(
        'profesionalId: en este centro factura cada profesional; elegí cuál',
      );
    }
    return this.emisorDatos(centroId, quien, profesionalId, centro);
  }

  /** Datos fiscales del profesional; sin cargar, se crean en modo simulado. */
  private async configProfesional(
    centroId: string,
    profesionalId: string,
  ): Promise<ConfigFiscal> {
    const db = this.db(centroId);
    const existe = await db.profesional.findFirst({
      where: { id: profesionalId },
      select: { id: true },
    });
    if (!existe) throw new NotFoundException('Profesional no encontrado');
    return db.configFiscal.upsert({
      where: { centroId_profesionalId: { centroId, profesionalId } },
      create: sinCentro<Prisma.ConfigFiscalUncheckedCreateInput>({
        profesionalId,
      }),
      update: {},
    });
  }

  /** Un profesional solo ve sus facturas; admin y recepción, todas (o las de uno). */
  private async filtroFacturas(
    centroId: string,
    quien: UsuarioAutenticado,
    profesionalId?: string,
  ): Promise<Prisma.FacturaWhereInput> {
    if (quien.rol === Rol.profesional)
      return { profesionalId: await this.miProfesional(centroId, quien) };
    return profesionalId ? { profesionalId } : {};
  }

  /** CAE ficticio y numeración propia del modo simulado (sin validez fiscal). */
  private async simular(
    centroId: string,
    c: ConfigFiscal,
    hoy: string,
  ): Promise<ResultadoFactura> {
    const ultima = await this.db(centroId).factura.aggregate({
      where: {
        configFiscalId: c.id,
        modo: ModoArca.simulado,
        ptoVta: c.ptoVta,
        cbteTipo: 11,
      },
      _max: { numero: true },
    });
    return {
      ok: true,
      numero: (ultima._max.numero ?? 0) + 1,
      cae: `7${String(randomInt(0, 1e13)).padStart(13, '0')}`,
      caeVence: sumarDias(hoy, 10),
      observaciones: 'Simulado: sin validez fiscal',
    };
  }

  private async cliente(
    centroId: string,
    c: ConfigFiscal,
  ): Promise<ClienteArca> {
    const clave = c.clavePrivada
      ? await this.cifrado.descifrarDato(
          centroId,
          c.clavePrivada,
          CONTEXTO_CLAVE,
        )
      : null;
    if (!c.cuit || !clave || !c.certificado) {
      throw new ConflictException(
        'Falta el CUIT, la clave o el certificado de ARCA (cargalos en Facturación → Datos fiscales)',
      );
    }
    const modo = c.modo as 'homologacion' | 'produccion';
    return new ClienteArca({
      modo,
      cuit: c.cuit,
      ptoVta: c.ptoVta,
      certificado: c.certificado,
      clave,
      ticket:
        c.ticketToken &&
        c.ticketSign &&
        c.ticketVence &&
        c.ticketModo === c.modo
          ? { token: c.ticketToken, sign: c.ticketSign, vence: c.ticketVence }
          : null,
      alRenovarTicket: async (t) => {
        await this.db(centroId).configFiscal.update({
          where: { id: c.id },
          data: {
            ticketToken: t.token,
            ticketSign: t.sign,
            ticketVence: t.vence,
            ticketModo: c.modo,
          },
        });
      },
      transporte: this.transporte,
    });
  }

  /** `centro`: fila del centro, para informar si factura cada profesional. */
  private vistaConfig(c: ConfigFiscal | null, centro: ConfigFiscal | null) {
    return {
      profesionalId: c?.profesionalId ?? null,
      facturaCadaProfesional: centro?.facturaCadaProfesional ?? false,
      cuit: c?.cuit ?? null,
      razonSocial: c?.razonSocial ?? null,
      domicilio: c?.domicilio ?? null,
      inicioActividades: aFechaSolo(c?.inicioActividades ?? null),
      ptoVta: c?.ptoVta ?? 1,
      modo: c?.modo ?? ModoArca.simulado,
      textoItem: c?.textoItem ?? 'Honorarios por sesión',
      tieneClave: !!c?.clavePrivada,
      tieneCertificado: !!c?.certificado,
      certificadoVence: c?.certificadoVence?.toISOString() ?? null,
    };
  }

  private async zona(centroId: string) {
    const c = await this.prisma.centro.findUniqueOrThrow({
      where: { id: centroId },
      select: { zonaHoraria: true },
    });
    return c.zonaHoraria;
  }

  private db(centroId: string): ClienteDeCentro {
    return this.prisma.paraCentro(centroId);
  }
}

// ───────── Controller ─────────

@ApiTags('facturación')
@ApiBearerAuth()
@RequiereModulo(Modulo.facturacion_arca)
// El profesional entra solo si el centro eligió que factura cada uno (lo controla el servicio).
@Roles(Rol.admin, Rol.recepcion, Rol.profesional)
@Controller('facturacion')
export class FacturacionController {
  constructor(private readonly facturacion: FacturacionService) {}

  @Get('config')
  config(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: emisorSchema }) q: z.infer<typeof emisorSchema>,
  ) {
    return this.facturacion.config(centroId, quien, q.profesionalId);
  }

  /** Profesionales y el estado de sus datos fiscales. */
  @Get('emisores')
  @Roles(Rol.admin, Rol.recepcion)
  emisores(@CentroActual() centroId: string) {
    return this.facturacion.emisores(centroId);
  }

  @Put('config')
  @Roles(Rol.admin, Rol.profesional)
  @ApiBodyZod(configSchema)
  guardarConfig(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: emisorSchema }) q: z.infer<typeof emisorSchema>,
    @Body({ schema: configSchema }) dto: z.infer<typeof configSchema>,
  ) {
    return this.facturacion.guardarConfig(
      centroId,
      quien,
      q.profesionalId,
      dto,
    );
  }

  /** Genera la clave y devuelve el pedido de certificado (CSR) para subir a ARCA. */
  @Post('config/pedido-certificado')
  @HttpCode(HttpStatus.OK)
  @Roles(Rol.admin, Rol.profesional)
  pedirCertificado(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: emisorSchema }) q: z.infer<typeof emisorSchema>,
  ) {
    return this.facturacion.pedirCertificado(centroId, quien, q.profesionalId);
  }

  @Put('config/certificado')
  @Roles(Rol.admin, Rol.profesional)
  @ApiBodyZod(certificadoSchema)
  guardarCertificado(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: emisorSchema }) q: z.infer<typeof emisorSchema>,
    @Body({ schema: certificadoSchema }) dto: z.infer<typeof certificadoSchema>,
  ) {
    return this.facturacion.guardarCertificado(
      centroId,
      quien,
      q.profesionalId,
      dto.certificado,
    );
  }

  @Post('probar')
  @HttpCode(HttpStatus.OK)
  probar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: emisorSchema }) q: z.infer<typeof emisorSchema>,
  ) {
    return this.facturacion.probar(centroId, quien, q.profesionalId);
  }

  @Get('pendientes')
  pendientes(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: mesSchema }) q: z.infer<typeof mesSchema>,
  ) {
    return this.facturacion.pendientes(
      centroId,
      quien,
      q.mes,
      q.profesionalId,
      q.incluirFaltazos ?? false,
    );
  }

  @Post('emitir')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(emitirSchema)
  emitir(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Body({ schema: emitirSchema }) dto: z.infer<typeof emitirSchema>,
  ) {
    return this.facturacion.emitir(
      centroId,
      quien,
      dto.mes,
      dto.pacienteIds,
      dto.profesionalId,
      dto.incluirFaltazos,
    );
  }

  @Get('facturas')
  listar(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: mesSchema }) q: z.infer<typeof mesSchema>,
  ) {
    return this.facturacion.listar(centroId, quien, q.mes, q.profesionalId);
  }

  @Patch('facturas/:id')
  @ApiBodyZod(enviadaSchema)
  marcarEnviada(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: enviadaSchema }) dto: z.infer<typeof enviadaSchema>,
  ) {
    return this.facturacion.marcarEnviada(centroId, quien, id, dto.enviada);
  }

  @Get('facturas/:id/pdf')
  async pdf(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Param('id', { schema: idParam }) id: string,
  ) {
    const { nombre, datos } = await this.facturacion.pdf(centroId, quien, id);
    return new StreamableFile(datos, {
      type: 'application/pdf',
      disposition: `inline; filename="${nombre}"`,
    });
  }
}

@Module({
  controllers: [FacturacionController],
  providers: [FacturacionService, CifradoService],
})
export class FacturacionModule {}

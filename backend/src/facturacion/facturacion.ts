import {
  BadRequestException,
  Body,
  ConflictException,
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
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { CentroActual, Roles } from '../auth/decoradores.js';
import { cobroDe, num, sumar, type Decimal } from '../cobros/reglas.js';
import { aFechaSolo, idParam, textoOpcional } from '../common/comunes.js';
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
  type ConfigFiscal,
} from '../generated/prisma/client.js';
import { CifradoService } from '../notas/cifrado.js';
import { RequiereModulo } from '../planes/planes.js';
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
});
const certificadoSchema = z.object({
  certificado: z.string().min(100).max(20_000),
});
const emitirSchema = z.object({
  mes: mesTexto,
  pacienteIds: z.array(z.uuid()).min(1).max(300),
});
const mesSchema = z.object({ mes: mesTexto });
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

/**
 * Factura electrónica C (monotributo) con ARCA, portado de facturacion.php: por
 * mes, una factura por paciente particular con las sesiones ya cobradas y sin
 * facturar. Los datos fiscales y el certificado son del centro.
 */
@Injectable()
export class FacturacionService {
  /** Para los tests: reemplaza la conexión con ARCA. */
  transporte?: Transporte;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cifrado: CifradoService,
  ) {}

  async config(centroId: string) {
    const c = await this.db(centroId).configFiscal.findUnique({
      where: { centroId },
    });
    return this.vistaConfig(c);
  }

  async guardarConfig(centroId: string, dto: z.infer<typeof configSchema>) {
    const datos = {
      ...dto,
      ...(dto.inicioActividades !== undefined
        ? {
            inicioActividades: dto.inicioActividades
              ? dia(dto.inicioActividades)
              : null,
          }
        : {}),
    };
    const c = await this.db(centroId).configFiscal.upsert({
      where: { centroId },
      create: sinCentro<Prisma.ConfigFiscalUncheckedCreateInput>(datos),
      update: {
        ...datos,
        ...(dto.modo
          ? { ticketToken: null, ticketSign: null, ticketVence: null }
          : {}),
      },
    });
    return this.vistaConfig(c);
  }

  /** Genera la clave privada (queda cifrada en la base) y devuelve el pedido de certificado. */
  async pedirCertificado(centroId: string) {
    const c = await this.db(centroId).configFiscal.findUnique({
      where: { centroId },
    });
    if (!c?.cuit) throw new BadRequestException('Primero guardá el CUIT');
    const { clavePem, csrPem } = generarCsr(c.cuit, c.razonSocial ?? '');
    await this.db(centroId).configFiscal.update({
      where: { centroId },
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

  async guardarCertificado(centroId: string, pem: string) {
    const c = await this.db(centroId).configFiscal.findUnique({
      where: { centroId },
    });
    const clave = c?.clavePrivada
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
      where: { centroId },
      data: {
        certificado: pem.trim(),
        certificadoVence: info.vence,
        ticketToken: null,
        ticketSign: null,
        ticketVence: null,
      },
    });
    return this.vistaConfig(act);
  }

  /** Prueba la conexión: el estado de los servidores y el último número del punto de venta. */
  async probar(centroId: string) {
    const c = await this.exigirConfig(centroId);
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
  async pendientes(centroId: string, mes: string) {
    const filas = await this.db(centroId).prestacion.findMany({
      where: { periodo: periodoDe(mes), financiadorId: null, facturaId: null },
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
        impagas: number;
      }
    >();
    for (const p of filas) {
      const g = porPaciente.get(p.pacienteId) ?? {
        paciente: p.paciente,
        cobradas: [],
        impagas: 0,
      };
      porPaciente.set(p.pacienteId, g);
      if (cobroDe(p.monto, p.pagos).estado === 'cobrada') g.cobradas.push(p);
      else g.impagas++;
    }
    return [...porPaciente.values()]
      .sort((a, b) => a.paciente.apellido.localeCompare(b.paciente.apellido))
      .map((g) => ({
        paciente: g.paciente,
        sesiones: g.cobradas.length,
        prestacionIds: g.cobradas.map((p) => p.id),
        items: agrupar(g.cobradas.map((p) => p.monto)),
        total: num(sumar(g.cobradas.map((p) => p.monto))),
        impagas: g.impagas,
        sinDni: !g.paciente.dni,
      }));
  }

  /** Emite una factura por paciente elegido. Si ARCA no responde, corta ahí. */
  async emitir(centroId: string, mes: string, pacienteIds: string[]) {
    const c = await this.exigirConfig(centroId);
    if (c.modo !== ModoArca.simulado && (!c.cuit || !c.razonSocial)) {
      throw new ConflictException(
        'Completá el CUIT y la razón social del centro',
      );
    }
    const cliente =
      c.modo === ModoArca.simulado ? null : await this.cliente(centroId, c);
    const zona = await this.zona(centroId);
    const hoy = aLocal(new Date(), zona).fecha;
    const { primero, ultimo } = diasDelMes(mes);
    const elegidos = (await this.pendientes(centroId, mes)).filter(
      (g) => g.sesiones > 0 && pacienteIds.includes(g.paciente.id),
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
          : await this.simular(centroId, c.ptoVta, hoy);
      } catch (e) {
        resultados.push({
          pacienteId: g.paciente.id,
          ok: false,
          error: (e as Error).message,
        });
        break;
      }
      const factura = await this.db(centroId).$transaction(async (tx) => {
        const f = await tx.factura.create({
          data: sinCentro<Prisma.FacturaUncheckedCreateInput>({
            pacienteId: g.paciente.id,
            periodo: periodoDe(mes),
            fecha: dia(hoy),
            ptoVta: c.ptoVta,
            cbteTipo: 11,
            numero: r.ok ? r.numero : null,
            docTipo: doc ? 96 : 99,
            docNro: doc || '0',
            total: g.total,
            detalle: g.items.map((it) => ({ descripcion: c.textoItem, ...it })),
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

  async listar(centroId: string, mes: string) {
    const facturas = await this.db(centroId).factura.findMany({
      where: { periodo: periodoDe(mes) },
      include: {
        paciente: {
          select: { id: true, nombre: true, apellido: true, telefono: true },
        },
        _count: { select: { prestaciones: true } },
      },
      orderBy: [{ creadaEn: 'desc' }],
    });
    return facturas.map((f) => ({
      id: f.id,
      paciente: f.paciente,
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

  async marcarEnviada(centroId: string, id: string, enviada: boolean) {
    const r = await this.db(centroId).factura.updateMany({
      where: { id },
      data: { enviada },
    });
    if (!r.count) throw new NotFoundException('Factura no encontrada');
    return { enviada };
  }

  async pdf(
    centroId: string,
    id: string,
  ): Promise<{ nombre: string; datos: Buffer }> {
    const f = await this.db(centroId).factura.findUnique({
      where: { id },
      include: { paciente: { select: { nombre: true, apellido: true } } },
    });
    if (!f || f.estado !== EstadoFactura.emitida)
      throw new NotFoundException('Factura no encontrada');
    const c = await this.db(centroId).configFiscal.findUnique({
      where: { centroId },
    });
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
        razonSocial: c?.razonSocial ?? 'Razón social sin cargar',
        cuit: c?.cuit ?? '00000000000',
        domicilio: c?.domicilio ?? null,
        inicioActividades: aFechaSolo(c?.inicioActividades ?? null),
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

  /** CAE ficticio y numeración propia del modo simulado (sin validez fiscal). */
  private async simular(
    centroId: string,
    ptoVta: number,
    hoy: string,
  ): Promise<ResultadoFactura> {
    const ultima = await this.db(centroId).factura.aggregate({
      where: { modo: ModoArca.simulado, ptoVta, cbteTipo: 11 },
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
          where: { centroId },
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

  /** Datos fiscales del centro; sin cargar, los valores por defecto (modo simulado). */
  private async exigirConfig(centroId: string): Promise<ConfigFiscal> {
    return this.db(centroId).configFiscal.upsert({
      where: { centroId },
      create: sinCentro<Prisma.ConfigFiscalUncheckedCreateInput>({}),
      update: {},
    });
  }

  private vistaConfig(c: ConfigFiscal | null) {
    return {
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
@Roles(Rol.admin, Rol.recepcion)
@Controller('facturacion')
export class FacturacionController {
  constructor(private readonly facturacion: FacturacionService) {}

  @Get('config')
  config(@CentroActual() centroId: string) {
    return this.facturacion.config(centroId);
  }

  @Put('config')
  @Roles(Rol.admin)
  @ApiBodyZod(configSchema)
  guardarConfig(
    @CentroActual() centroId: string,
    @Body({ schema: configSchema }) dto: z.infer<typeof configSchema>,
  ) {
    return this.facturacion.guardarConfig(centroId, dto);
  }

  /** Genera la clave y devuelve el pedido de certificado (CSR) para subir a ARCA. */
  @Post('config/pedido-certificado')
  @HttpCode(HttpStatus.OK)
  @Roles(Rol.admin)
  pedirCertificado(@CentroActual() centroId: string) {
    return this.facturacion.pedirCertificado(centroId);
  }

  @Put('config/certificado')
  @Roles(Rol.admin)
  @ApiBodyZod(certificadoSchema)
  guardarCertificado(
    @CentroActual() centroId: string,
    @Body({ schema: certificadoSchema }) dto: z.infer<typeof certificadoSchema>,
  ) {
    return this.facturacion.guardarCertificado(centroId, dto.certificado);
  }

  @Post('probar')
  @HttpCode(HttpStatus.OK)
  probar(@CentroActual() centroId: string) {
    return this.facturacion.probar(centroId);
  }

  @Get('pendientes')
  pendientes(
    @CentroActual() centroId: string,
    @Query({ schema: mesSchema }) q: z.infer<typeof mesSchema>,
  ) {
    return this.facturacion.pendientes(centroId, q.mes);
  }

  @Post('emitir')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(emitirSchema)
  emitir(
    @CentroActual() centroId: string,
    @Body({ schema: emitirSchema }) dto: z.infer<typeof emitirSchema>,
  ) {
    return this.facturacion.emitir(centroId, dto.mes, dto.pacienteIds);
  }

  @Get('facturas')
  listar(
    @CentroActual() centroId: string,
    @Query({ schema: mesSchema }) q: z.infer<typeof mesSchema>,
  ) {
    return this.facturacion.listar(centroId, q.mes);
  }

  @Patch('facturas/:id')
  @ApiBodyZod(enviadaSchema)
  marcarEnviada(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
    @Body({ schema: enviadaSchema }) dto: z.infer<typeof enviadaSchema>,
  ) {
    return this.facturacion.marcarEnviada(centroId, id, dto.enviada);
  }

  @Get('facturas/:id/pdf')
  async pdf(
    @CentroActual() centroId: string,
    @Param('id', { schema: idParam }) id: string,
  ) {
    const { nombre, datos } = await this.facturacion.pdf(centroId, id);
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

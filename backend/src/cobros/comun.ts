import { ForbiddenException } from '@nestjs/common';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { aFechaSolo } from '../common/comunes.js';
import { aLocal } from '../common/tiempo.js';
import { EstadoLiquidacion, Prisma, Rol } from '../generated/prisma/client.js';
import type { ClienteDeCentro } from '../prisma/centro.js';
import { avisosDe, cobroDe, num, type Decimal } from './reglas.js';

/**
 * Lo que usan los servicios de cobros. Acepta tanto el cliente de centro como la
 * transacción que sale de él (los dos filtran por centro).
 */
export type DbCobros = Pick<
  ClienteDeCentro,
  | 'prestacion'
  | 'pago'
  | 'precio'
  | 'orden'
  | 'financiador'
  | 'paciente'
  | 'profesional'
  | 'liquidacion'
  | 'acuerdoAlquiler'
  | 'turno'
>;

export const ESTADOS_CERRADOS = [
  EstadoLiquidacion.cerrada,
  EstadoLiquidacion.pagada,
];

export const INCLUDE_PRESTACION = {
  turno: { select: { inicio: true } },
  paciente: { select: { id: true, nombre: true, apellido: true } },
  profesional: {
    select: { id: true, nombre: true, apellido: true, disciplina: true },
  },
  financiador: {
    select: {
      id: true,
      nombre: true,
      tipo: true,
      requiereOrden: true,
      requiereToken: true,
    },
  },
  orden: {
    select: { id: true, numero: true, fechaEmision: true, vence: true },
  },
  pagos: { orderBy: [{ fecha: 'asc' }, { creadoEn: 'asc' }] },
} satisfies Prisma.PrestacionInclude;

export type PrestacionCompleta = Prisma.PrestacionGetPayload<{
  include: typeof INCLUDE_PRESTACION;
}>;

const fecha = (d: Date) => aFechaSolo(d)!;

/** Prestación como la devuelve la API, con su cobro y sus avisos. */
export function vistaPrestacion(
  p: PrestacionCompleta,
  zona: string,
  cerrada: boolean,
) {
  const cobro = cobroDe(p.monto, p.pagos);
  const orden = p.orden
    ? {
        id: p.orden.id,
        numero: p.orden.numero,
        fechaEmision: fecha(p.orden.fechaEmision),
        vence: aFechaSolo(p.orden.vence),
      }
    : null;
  const f = fecha(p.fecha);
  return {
    id: p.id,
    turnoId: p.turnoId,
    fecha: f,
    hora: aLocal(p.turno.inicio, zona).hora,
    paciente: p.paciente,
    profesional: p.profesional,
    financiador: p.financiador,
    monto: num(p.monto),
    montoManual: p.montoManual,
    facturada: p.facturada,
    token: p.token,
    fechaDeclarada: aFechaSolo(p.fechaDeclarada),
    facturaId: p.facturaId,
    orden,
    cobrado: num(cobro.cobrado),
    saldo: num(cobro.saldo),
    estadoCobro: cobro.estado,
    pagos: p.pagos.map(vistaPago),
    avisos: avisosDe({
      // Para la orden cuenta la fecha que se declara, si ya está.
      fecha: aFechaSolo(p.fechaDeclarada) ?? f,
      monto: p.monto,
      facturada: p.facturada,
      token: p.token,
      financiador: p.financiador,
      orden,
      estadoCobro: cobro.estado,
    }),
    /** La liquidación del mes está cerrada: no se cambian monto ni financiador. */
    cerrada,
  };
}
export type PrestacionVista = ReturnType<typeof vistaPrestacion>;

export function vistaPago(p: {
  id: string;
  monto: Decimal;
  fecha: Date;
  medio: string;
  estado: string;
  observaciones: string | null;
}) {
  return {
    id: p.id,
    monto: num(p.monto),
    fecha: fecha(p.fecha),
    medio: p.medio,
    estado: p.estado,
    observaciones: p.observaciones,
  };
}

/** "profesionalId|2026-11-01" de las liquidaciones cerradas o pagadas. */
export async function mesesCerrados(
  db: DbCobros,
  where: Prisma.LiquidacionWhereInput = {},
): Promise<Set<string>> {
  const filas = await db.liquidacion.findMany({
    where: { ...where, estado: { in: ESTADOS_CERRADOS } },
    select: { profesionalId: true, periodo: true },
  });
  return new Set(filas.map((l) => claveMes(l.profesionalId, l.periodo)));
}

export const claveMes = (profesionalId: string, periodo: Date) =>
  `${profesionalId}|${fecha(periodo)}`;

/**
 * Valor de la sesión en una fecha: primero el precio especial del paciente con
 * esa cobertura, si no el general de la cobertura (financiador o particular).
 * Sin precio cargado: 0 (la conciliación lo avisa).
 */
export async function precioVigente(
  db: DbCobros,
  pacienteId: string,
  financiadorId: string | null,
  dia: Date,
): Promise<Decimal> {
  for (const paciente of [pacienteId, null]) {
    const p = await db.precio.findFirst({
      where: {
        pacienteId: paciente,
        financiadorId,
        vigenteDesde: { lte: dia },
      },
      orderBy: [{ vigenteDesde: 'desc' }, { creadoEn: 'desc' }],
      select: { monto: true },
    });
    if (p) return p.monto;
  }
  return new Prisma.Decimal(0);
}

/**
 * Orden del paciente para ese financiador que vale en la fecha y todavía tiene
 * sesiones libres (la más vieja primero, para gastarlas en orden).
 */
export async function ordenDisponible(
  db: DbCobros,
  pacienteId: string,
  financiadorId: string,
  dia: Date,
  ignorarPrestacionId?: string,
): Promise<string | null> {
  const ordenes = await db.orden.findMany({
    where: {
      pacienteId,
      financiadorId,
      fechaEmision: { lte: dia },
      OR: [{ vence: null }, { vence: { gte: dia } }],
    },
    orderBy: [{ fechaEmision: 'asc' }, { creadaEn: 'asc' }],
    select: {
      id: true,
      sesiones: true,
      _count: {
        select: {
          prestaciones: ignorarPrestacionId
            ? { where: { id: { not: ignorarPrestacionId } } }
            : true,
        },
      },
    },
  });
  return ordenes.find((o) => o._count.prestaciones < o.sesiones)?.id ?? null;
}

/**
 * Qué prestaciones puede ver quien pregunta: admin y recepción, todas; un
 * profesional, solo las suyas.
 */
export async function alcanceDe(
  db: DbCobros,
  quien: UsuarioAutenticado,
): Promise<{ profesionalId?: string }> {
  if (quien.rol !== Rol.profesional) return {};
  const yo = await db.profesional.findFirst({
    where: { usuarioId: quien.usuarioId },
    select: { id: true },
  });
  if (!yo) {
    throw new ForbiddenException(
      'Tu cuenta no está vinculada a una ficha de profesional',
    );
  }
  return { profesionalId: yo.id };
}

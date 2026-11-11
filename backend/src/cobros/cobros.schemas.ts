import { z } from 'zod';
import { textoOpcional } from '../common/comunes.js';
import { fechaTexto, mesTexto } from '../common/tiempo.js';
import { EstadoPago, MedioPago } from '../generated/prisma/client.js';

/** Monto en pesos con hasta dos decimales. */
const monto = z.number().min(0).max(9_999_999_999).multipleOf(0.01);
const montoPositivo = monto.refine((m) => m > 0, 'tiene que ser mayor a 0');

export const mesSchema = z.object({ mes: mesTexto });

export const listarPrestacionesSchema = z
  .object({
    mes: mesTexto.optional(),
    pacienteId: z.uuid().optional(),
    profesionalId: z.uuid().optional(),
    financiadorId: z.uuid().optional(),
    /** por_cobrar: todo lo que no está cobrado del todo. */
    estado: z.enum(['por_cobrar', 'cobrada']).optional(),
  })
  .refine((d) => d.mes || d.pacienteId, 'indicá el mes o el paciente');
export type ListarPrestacionesDto = z.infer<typeof listarPrestacionesSchema>;

export const actualizarPrestacionSchema = z
  .object({
    /** null: vuelve al precio vigente. */
    monto: monto.nullable(),
    /** null: particular. */
    financiadorId: z.uuid().nullable(),
    ordenId: z.uuid().nullable(),
    token: z
      .string()
      .trim()
      .toUpperCase()
      .max(20)
      .transform((s) => (s === '' ? null : s))
      .nullable(),
    facturada: z.boolean(),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'sin cambios');
export type ActualizarPrestacionDto = z.infer<
  typeof actualizarPrestacionSchema
>;

export const facturarSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(500),
  facturada: z.boolean().default(true),
});

export const crearPagoSchema = z.object({
  /** Por defecto, el saldo de la prestación. */
  monto: montoPositivo.optional(),
  /** Por defecto, hoy. */
  fecha: fechaTexto.optional(),
  medio: z.enum(MedioPago),
  /** Por defecto, cobrado. "pendiente": por ejemplo un cheque o una transferencia sin acreditar. */
  estado: z.enum(EstadoPago).default(EstadoPago.cobrado),
  observaciones: textoOpcional(200),
});
export type CrearPagoDto = z.infer<typeof crearPagoSchema>;

export const pagoLoteSchema = z.object({
  prestacionIds: z.array(z.uuid()).min(1).max(500),
  fecha: fechaTexto.optional(),
  medio: z.enum(MedioPago),
  estado: z.enum(EstadoPago).default(EstadoPago.cobrado),
  observaciones: textoOpcional(200),
});
export type PagoLoteDto = z.infer<typeof pagoLoteSchema>;

export const actualizarPagoSchema = z
  .object({
    monto: montoPositivo,
    fecha: fechaTexto,
    medio: z.enum(MedioPago),
    estado: z.enum(EstadoPago),
    observaciones: textoOpcional(200),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'sin cambios');
export type ActualizarPagoDto = z.infer<typeof actualizarPagoSchema>;

// ───────── Órdenes ─────────

export const listarOrdenesSchema = z.object({ pacienteId: z.uuid() });

export const crearOrdenSchema = z.object({
  pacienteId: z.uuid(),
  financiadorId: z.uuid(),
  numero: z.string().trim().min(1, 'obligatorio').max(40),
  fechaEmision: fechaTexto,
  /** Por defecto: emisión + días de validez del financiador. */
  vence: fechaTexto.nullable().optional(),
  sesiones: z.number().int().min(1).max(100),
  observaciones: textoOpcional(200),
});
export type CrearOrdenDto = z.infer<typeof crearOrdenSchema>;

export const actualizarOrdenSchema = crearOrdenSchema
  .pick({
    numero: true,
    fechaEmision: true,
    vence: true,
    sesiones: true,
    observaciones: true,
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'sin cambios');
export type ActualizarOrdenDto = z.infer<typeof actualizarOrdenSchema>;

// ───────── Precios ─────────

export const listarPreciosSchema = z.object({
  /** Sin paciente: los valores generales (de cada obra social y de particular). */
  pacienteId: z.uuid().optional(),
});

export const crearPrecioSchema = z.object({
  /** null: particular. */
  financiadorId: z.uuid().nullable(),
  /** Precio especial de un paciente (opcional). */
  pacienteId: z.uuid().nullable().optional(),
  monto,
  vigenteDesde: fechaTexto,
});
export type CrearPrecioDto = z.infer<typeof crearPrecioSchema>;

// ───────── Liquidaciones ─────────

export const generarLiquidacionSchema = z.object({
  profesionalId: z.uuid(),
  mes: mesTexto,
});

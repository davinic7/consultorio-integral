import { z } from 'zod';
import { boolQuery, textoOpcional } from '../common/comunes.js';
import { diasEntre, fechaTexto, horaTexto } from '../common/tiempo.js';

const duracionMin = z
  .number()
  .int()
  .min(5, 'mínimo 5 minutos')
  .max(480, 'máximo 8 horas');

export const crearTurnoSchema = z.object({
  pacienteId: z.uuid(),
  profesionalId: z.uuid(),
  salaId: z.uuid().nullable().optional(),
  /** Fecha y hora en la zona horaria del centro. */
  fecha: fechaTexto,
  hora: horaTexto,
  duracionMin,
  observaciones: textoOpcional(500),
});
export type CrearTurnoDto = z.infer<typeof crearTurnoSchema>;

export const moverTurnoSchema = z
  .object({
    fecha: fechaTexto,
    hora: horaTexto,
    duracionMin,
    salaId: z.uuid().nullable(),
    /** Solo admin y recepción pueden pasar el turno a otro profesional. */
    profesionalId: z.uuid(),
    observaciones: textoOpcional(500),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, 'sin cambios');
export type MoverTurnoDto = z.infer<typeof moverTurnoSchema>;

export const cancelarTurnoSchema = z.object({
  motivo: textoOpcional(300),
});
export type CancelarTurnoDto = z.infer<typeof cancelarTurnoSchema>;

/** Máximo de días que se puede pedir de una vez (una vista mensual con margen). */
export const MAX_DIAS_LISTADO = 42;

export const listarTurnosSchema = z
  .object({
    desde: fechaTexto,
    hasta: fechaTexto,
    profesionalId: z.uuid().optional(),
    salaId: z.uuid().optional(),
    pacienteId: z.uuid().optional(),
    incluirCancelados: boolQuery.optional(),
  })
  .refine(
    (d) => diasEntre(d.desde, d.hasta) >= 0,
    'hasta: no puede ser anterior a desde',
  )
  .refine(
    (d) => diasEntre(d.desde, d.hasta) < MAX_DIAS_LISTADO,
    `el rango no puede superar ${MAX_DIAS_LISTADO} días`,
  );
export type ListarTurnosDto = z.infer<typeof listarTurnosSchema>;

export const rangoSchema = z
  .object({ desde: fechaTexto, hasta: fechaTexto })
  .refine(
    (d) =>
      diasEntre(d.desde, d.hasta) >= 0 &&
      diasEntre(d.desde, d.hasta) < MAX_DIAS_LISTADO,
    `rango inválido (máximo ${MAX_DIAS_LISTADO} días)`,
  );

/** Sin fecha de fin, una recurrencia genera turnos por este período. */
export const SEMANAS_POR_DEFECTO = 26;

export const crearRecurrenciaSchema = z
  .object({
    pacienteId: z.uuid(),
    profesionalId: z.uuid(),
    salaId: z.uuid().nullable().optional(),
    /** 1 = lunes … 7 = domingo. */
    diaSemana: z.number().int().min(1).max(7),
    hora: horaTexto,
    duracionMin,
    fechaDesde: fechaTexto,
    fechaHasta: fechaTexto.optional(),
    observaciones: textoOpcional(500),
  })
  .refine(
    (d) => !d.fechaHasta || diasEntre(d.fechaDesde, d.fechaHasta) >= 0,
    'fechaHasta: no puede ser anterior a fechaDesde',
  )
  .refine(
    (d) => !d.fechaHasta || diasEntre(d.fechaDesde, d.fechaHasta) <= 366,
    'fechaHasta: como máximo un año después de fechaDesde',
  );
export type CrearRecurrenciaDto = z.infer<typeof crearRecurrenciaSchema>;

export const finalizarRecurrenciaSchema = z.object({
  /** Se cancelan los turnos pendientes desde esta fecha (incluida). */
  desde: fechaTexto,
});

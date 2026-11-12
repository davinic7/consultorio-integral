import type { EstadoMarcable, EstadoTurno } from './api/modelos';

/**
 * Al marcar "ausente con aviso" de un profesional con la regla de faltazo
 * activa, pregunta si el aviso llegó a tiempo. Devuelve avisoTarde (o
 * undefined si no hace falta preguntar).
 */
export function preguntarAvisoTarde(
  estado: string,
  regla: { activo: boolean; toleranciaHoras: number } | undefined,
  confirmar: (texto: string) => boolean = (t) => confirm(t),
): boolean | undefined {
  if (estado !== 'ausente_con_aviso' || !regla?.activo) return undefined;
  const aTiempo = confirmar(
    `¿El paciente avisó con al menos ${regla.toleranciaHoras} h de anticipación?\n\n` +
      'Aceptar: sí, avisó a tiempo (no se cobra).\n' +
      'Cancelar: no, avisó tarde (se cobra el faltazo si es particular).',
  );
  return !aTiempo;
}

export const NOMBRE_ESTADO: Record<EstadoTurno, string> = {
  pendiente: 'Pendiente',
  presente: 'Presente',
  ausente_con_aviso: 'Ausente con aviso',
  ausente_sin_aviso: 'Ausente sin aviso',
  cancelado_profesional: 'Cancelado',
};

/** Botones de marcado en un clic, en el orden en que se muestran. */
export const ESTADOS_MARCABLES: EstadoMarcable[] = [
  'presente',
  'ausente_con_aviso',
  'ausente_sin_aviso',
];

/** "presente" y "ausente sin aviso" solo una vez empezado el turno. */
export function sePuedeMarcar(estado: EstadoMarcable, inicio: string, ahora = Date.now()): boolean {
  if (estado === 'ausente_con_aviso' || estado === 'pendiente') return true;
  return new Date(inicio).getTime() <= ahora;
}

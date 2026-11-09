import type { EstadoMarcable, EstadoTurno } from './api/modelos';

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

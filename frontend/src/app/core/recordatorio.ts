import type { Paciente, Turno } from './api/modelos';
import { enlaceWhatsApp } from './contacto';
import { diaSemana, NOMBRE_DIA, sumarDias } from './fechas';

/** A quién se le escribe: al paciente o, si no tiene teléfono, a su responsable. */
export function destinatario(
  p: Pick<Paciente, 'nombre' | 'telefono' | 'responsableNombre' | 'responsableTelefono'>,
): { nombre: string; telefono: string } | null {
  if (p.telefono?.trim()) return { nombre: p.nombre, telefono: p.telefono };
  if (p.responsableTelefono?.trim())
    return { nombre: p.responsableNombre?.trim() || p.nombre, telefono: p.responsableTelefono };
  return null;
}

/** "hoy", "mañana" o "el martes 18/11". */
function cuando(fecha: string, hoy: string): string {
  if (fecha === hoy) return 'hoy';
  if (fecha === sumarDias(hoy, 1)) return 'mañana';
  const [, m, d] = fecha.split('-');
  return `el ${NOMBRE_DIA[diaSemana(fecha) - 1].toLowerCase()} ${d}/${m}`;
}

/** Texto del recordatorio, sin datos clínicos: día, hora, profesional y centro. */
export function textoRecordatorio(
  turno: Pick<Turno, 'fecha' | 'hora' | 'paciente' | 'profesional'>,
  saludo: string,
  centro: string,
  hoy: string,
): string {
  const prof = `${turno.profesional.nombre} ${turno.profesional.apellido}`;
  const para = saludo === turno.paciente.nombre ? '' : ` de ${turno.paciente.nombre}`;
  return (
    `Hola ${saludo}, te recordamos el turno${para} ${cuando(turno.fecha, hoy)} a las ` +
    `${turno.hora} con ${prof} en ${centro}. Si no pueden venir, avisanos con tiempo. ¡Gracias!`
  );
}

/** Enlace de WhatsApp con el recordatorio listo, o null si no hay un teléfono válido. */
export function enlaceRecordatorio(
  turno: Pick<Turno, 'fecha' | 'hora' | 'paciente' | 'profesional'>,
  paciente: Pick<Paciente, 'nombre' | 'telefono' | 'responsableNombre' | 'responsableTelefono'>,
  centro: string,
  hoy: string,
): string | null {
  const d = destinatario(paciente);
  const enlace = d && enlaceWhatsApp(d.telefono);
  if (!d || !enlace) return null;
  return `${enlace}?text=${encodeURIComponent(textoRecordatorio(turno, d.nombre, centro, hoy))}`;
}

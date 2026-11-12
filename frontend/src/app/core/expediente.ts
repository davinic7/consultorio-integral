import type { Nota, SesionNota } from './api/modelos';
import { diaSemana, sumarDias } from './fechas';

/**
 * Lógica del expediente sin Angular: guía de estructura, filtros, agrupado por mes
 * y fechas en la zona del centro. Ver docs/diseno/expediente-dictado.md.
 */

/** Títulos de la guía de estructura, en orden. Son opcionales. */
export const GUIA = ['Motivo', 'Desarrollo de la sesión', 'Observaciones', 'Plan'] as const;

export type Periodo = 'd7' | 'd30' | 'anio' | 'todo';
export type FiltroAutor = 'todas' | 'mias' | 'equipo';

export const PERIODOS: readonly { id: Periodo; texto: string }[] = [
  { id: 'd7', texto: '7 días' },
  { id: 'd30', texto: '30 días' },
  { id: 'anio', texto: 'Este año' },
  { id: 'todo', texto: 'Todo' },
];

export const AUTORES: readonly { id: FiltroAutor; texto: string }[] = [
  { id: 'todas', texto: 'Todas' },
  { id: 'mias', texto: 'Mías' },
  { id: 'equipo', texto: 'Del equipo' },
];

const DIAS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

// ───────── Guía de estructura ─────────

/** Texto inicial con la guía: cada título en su renglón y uno libre para escribir. */
export function plantillaGuia(): string {
  return GUIA.map((t) => `${t}\n`).join('\n');
}

export interface Seccion {
  /** Título de la guía, o null para texto suelto. */
  titulo: string | null;
  texto: string;
}

function tituloDeGuia(renglon: string): string | null {
  const limpio = renglon.trim().replace(/:$/, '').toLocaleLowerCase('es');
  return GUIA.find((g) => g.toLocaleLowerCase('es') === limpio) ?? null;
}

/**
 * Parte el texto en secciones según los títulos de la guía (con o sin dos puntos).
 * Un título sin nada debajo no cuenta. Se respetan los renglones de cada sección.
 */
export function secciones(texto: string): Seccion[] {
  const salida: Seccion[] = [];
  let titulo: string | null = null;
  let renglones: string[] = [];
  const cerrar = () => {
    const cuerpo = renglones.join('\n').trim();
    if (cuerpo) salida.push({ titulo, texto: cuerpo });
    renglones = [];
  };
  for (const renglon of texto.split(/\r?\n/)) {
    const t = tituloDeGuia(renglon);
    if (t) {
      cerrar();
      titulo = t;
    } else {
      renglones.push(renglon);
    }
  }
  cerrar();
  return salida;
}

/** Sin nada escrito más allá de los títulos de la guía. */
export function estaVacio(texto: string): boolean {
  return secciones(texto).length === 0;
}

/** Texto corrido para la vista resumida de la línea de tiempo. */
export function resumen(texto: string): string {
  return secciones(texto)
    .map((s) => (s.titulo ? `${s.titulo}: ` : '') + s.texto.replace(/\s+/g, ' '))
    .join(' · ');
}

/**
 * Texto que se guarda: sin los títulos de la guía que quedaron vacíos ni renglones
 * de sobra al principio o al final.
 */
export function textoParaGuardar(texto: string): string {
  return secciones(texto)
    .map((s) => (s.titulo ? `${s.titulo}\n${s.texto}` : s.texto))
    .join('\n\n');
}

/** Suma un tramo nuevo al final del borrador, separado por un renglón libre. */
export function sumarAlFinal(borrador: string, nuevo: string): string {
  const a = borrador.trimEnd();
  const b = nuevo.trim();
  if (!b) return borrador;
  return a ? `${a}\n\n${b}` : b;
}

// ───────── Fechas en la zona del centro ─────────

const formatos = new Map<string, Intl.DateTimeFormat>();

/** Instante ISO → fecha (AAAA-MM-DD) y hora (HH:MM) en la zona del centro. */
export function local(iso: string, zona: string): { fecha: string; hora: string } {
  let f = formatos.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: zona,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatos.set(zona, f);
  }
  const partes = f.formatToParts(new Date(iso));
  const v = (t: string) => partes.find((p) => p.type === t)?.value ?? '00';
  return { fecha: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour')}:${v('minute')}` };
}

/** "09/11" (o "09/11/2025" si no es de este año). */
function diaMes(fecha: string, hoy?: string): string {
  const dm = `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
  return hoy && hoy.slice(0, 4) !== fecha.slice(0, 4) ? `${dm}/${fecha.slice(0, 4)}` : dm;
}

/** Cuándo fue la sesión: la del turno vinculado o, si no hay, cuando se escribió. */
export function momentoDe(n: Nota): string {
  return n.turno?.inicio ?? n.creadaEn;
}

/** "lun 09/11 · 11:00" */
export function etiquetaMomento(iso: string, zona: string, hoy?: string): string {
  const { fecha, hora } = local(iso, zona);
  return `${DIAS[diaSemana(fecha) - 1]} ${diaMes(fecha, hoy)} · ${hora}`;
}

/** "09/11 a las 11:52" */
export function fechaYHora(iso: string, zona: string, hoy?: string): string {
  const { fecha, hora } = local(iso, zona);
  return `${diaMes(fecha, hoy)} a las ${hora}`;
}

/** "noviembre 2026" */
export function mesDe(iso: string, zona: string): string {
  const { fecha } = local(iso, zona);
  return `${MESES[Number(fecha.slice(5, 7)) - 1]} ${fecha.slice(0, 4)}`;
}

// ───────── Filtros y agrupado ─────────

export interface Filtro {
  q: string;
  periodo: Periodo;
  autor: FiltroAutor;
}

export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('es');
}

/** Primer día que entra en el período (inclusive), o null para "todo". */
export function desdePeriodo(periodo: Periodo, hoy: string): string | null {
  if (periodo === 'd7') return sumarDias(hoy, -6);
  if (periodo === 'd30') return sumarDias(hoy, -29);
  if (periodo === 'anio') return `${hoy.slice(0, 4)}-01-01`;
  return null;
}

/** El texto está cifrado en la base: se busca acá, ya descifrado. */
export function filtrar(notas: Nota[], f: Filtro, hoy: string, zona: string): Nota[] {
  const q = normalizar(f.q.trim());
  const desde = desdePeriodo(f.periodo, hoy);
  return notas.filter((n) => {
    if (f.autor === 'mias' && !n.propia) return false;
    if (f.autor === 'equipo' && n.propia) return false;
    if (desde && local(momentoDe(n), zona).fecha < desde) return false;
    if (q) {
      const p = n.profesional;
      if (!normalizar(`${n.texto} ${p.nombre} ${p.apellido} ${p.disciplina}`).includes(q)) {
        return false;
      }
    }
    return true;
  });
}

/** De la sesión más nueva a la más vieja; a igual sesión, la escrita última primero. */
export function ordenar(notas: Nota[]): Nota[] {
  return [...notas].sort(
    (a, b) => momentoDe(b).localeCompare(momentoDe(a)) || b.creadaEn.localeCompare(a.creadaEn),
  );
}

export interface GrupoMes {
  clave: string;
  mes: string;
  notas: Nota[];
}

/** Agrupa por mes de la sesión, respetando el orden recibido. */
export function agruparPorMes(notas: Nota[], zona: string): GrupoMes[] {
  const grupos: GrupoMes[] = [];
  for (const n of notas) {
    const iso = momentoDe(n);
    const clave = local(iso, zona).fecha.slice(0, 7);
    let g = grupos.find((x) => x.clave === clave);
    if (!g) {
      g = { clave, mes: mesDe(iso, zona), notas: [] };
      grupos.push(g);
    }
    g.notas.push(n);
  }
  return grupos;
}

// ───────── Sesiones ─────────

/** "Hoy 12/11 · 11:00 · Sala 2", "lun 09/11 · 11:00" … */
export function etiquetaSesion(s: SesionNota, hoy: string): string {
  const dia = s.fecha === hoy ? 'Hoy' : DIAS[diaSemana(s.fecha) - 1];
  const sala = s.sala ? ` · ${s.sala.nombre}` : '';
  const ya = s.conNota ? ' (ya tiene evolución)' : '';
  return `${dia} ${diaMes(s.fecha, hoy)} · ${s.hora}${sala}${ya}`;
}

/** Por defecto, el turno de hoy con el paciente que todavía no tiene evolución. */
export function sesionPorDefecto(turnos: SesionNota[], hoy: string): string | null {
  return turnos.find((t) => t.fecha === hoy && !t.conNota)?.id ?? null;
}

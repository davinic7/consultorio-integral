/**
 * Reglas para presentar sesiones a una obra social (portadas de reglas.php de
 * la referencia: sugerir_fechas_osep y emparejar_tokens), sin base de datos.
 */

/** Semana ISO de una fecha ("2026-W45"), para contar sesiones por semana. */
export function semanaDe(fecha: string): string {
  const d = Temporal.PlainDate.from(fecha);
  // El año de la semana ISO es el de su jueves.
  const jueves = d.add({ days: 4 - d.dayOfWeek });
  return `${jueves.year}-W${String(d.weekOfYear).padStart(2, '0')}`;
}

export interface Sugerencia {
  real: string;
  /** null: no entra con las reglas. */
  sugerida: string | null;
  aviso: string | null;
}

const ddmm = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

/**
 * Fecha a declarar para cada sesión asistida. Reglas: una por día, nunca antes
 * de la emisión de la orden, dentro del mes y antes del vencimiento de la orden,
 * en días de atención y como máximo `maxSemana` por semana. Si la fecha real no
 * cumple, se corre al siguiente día que cumpla.
 */
export function sugerirFechas(p: {
  mes: string;
  reales: string[];
  emision?: string | null;
  vence?: string | null;
  /** Fechas ya declaradas de otras sesiones (no se repiten). */
  ocupadas?: string[];
  maxSemana?: number | null;
  /** 1 = lunes … 7 = domingo. Por defecto, de lunes a sábado. */
  diasAtencion?: number[];
}): Sugerencia[] {
  const inicioMes = `${p.mes}-01`;
  const finMes = Temporal.PlainDate.from(inicioMes)
    .add({ months: 1 })
    .subtract({ days: 1 })
    .toString();
  const porVencimiento = !!p.vence && p.vence < finMes;
  const fin = porVencimiento ? p.vence! : finMes;
  const desde = p.emision && p.emision > inicioMes ? p.emision : inicioMes;
  const dias = new Set(p.diasAtencion ?? [1, 2, 3, 4, 5, 6]);
  const max = p.maxSemana ?? Infinity;
  const ocupadas = new Set(p.ocupadas ?? []);
  const porSemana = new Map<string, number>();
  for (const o of ocupadas)
    porSemana.set(semanaDe(o), (porSemana.get(semanaDe(o)) ?? 0) + 1);

  const res: Sugerencia[] = [];
  let anterior: string | null = null;
  for (const real of [...p.reales].sort()) {
    let c = [real, desde].sort().at(-1)!;
    if (anterior && c <= anterior)
      c = Temporal.PlainDate.from(anterior).add({ days: 1 }).toString();
    let elegida: string | null = null;
    while (c <= fin) {
      const d = Temporal.PlainDate.from(c);
      if (
        dias.has(d.dayOfWeek) &&
        !ocupadas.has(c) &&
        (porSemana.get(semanaDe(c)) ?? 0) < max
      ) {
        elegida = c;
        break;
      }
      c = d.add({ days: 1 }).toString();
    }
    let aviso: string | null = null;
    if (!elegida) {
      aviso = porVencimiento
        ? `No entra: la orden vence el ${ddmm(p.vence!)}`
        : 'No entra en el mes con las reglas';
    } else {
      ocupadas.add(elegida);
      porSemana.set(
        semanaDe(elegida),
        (porSemana.get(semanaDe(elegida)) ?? 0) + 1,
      );
      anterior = elegida;
      if (elegida !== real)
        aviso =
          p.emision && real < p.emision
            ? `Movida: orden emitida el ${ddmm(p.emision)}`
            : 'Movida: semana llena o día ocupado';
    }
    res.push({ real, sugerida: elegida, aviso });
  }
  return res;
}

// ───────── Tokens ─────────

export interface ItemToken {
  token: string;
  afiliado?: string | null;
  dni?: string | null;
  /** Elegido a mano. */
  pacienteId?: string | null;
}

export interface PacienteToken {
  id: string;
  dni: string | null;
  nroAfiliado: string | null;
}

export type EstadoToken =
  'ok' | 'duplicado' | 'sin_paciente' | 'sin_sesion' | 'invalido';

export interface ResultadoToken {
  token: string;
  pacienteId: string | null;
  /** Cómo se encontró al paciente. */
  por: 'manual' | 'afiliado' | 'dni' | null;
  prestacionId: string | null;
  fecha: string | null;
  estado: EstadoToken;
}

const digitos = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

/**
 * Asigna tokens a sesiones: busca al paciente por n.º de afiliado (solo
 * dígitos), si no por DNI, y le da el token a su primera sesión del mes que
 * todavía no tiene. Un token repetido para el mismo paciente se descarta.
 */
export function emparejarTokens(
  items: ItemToken[],
  pacientes: PacienteToken[],
  /** Sesiones sin token de cada paciente, en orden de fecha. */
  libres: Map<string, { id: string; fecha: string }[]>,
  /** Tokens ya cargados de cada paciente. */
  usados: Map<string, Set<string>>,
): ResultadoToken[] {
  const porAfiliado = new Map<string, string>();
  const porDni = new Map<string, string>();
  const ids = new Set(pacientes.map((p) => p.id));
  for (const p of pacientes) {
    if (digitos(p.nroAfiliado)) porAfiliado.set(digitos(p.nroAfiliado), p.id);
    if (digitos(p.dni)) porDni.set(digitos(p.dni), p.id);
  }
  const pendientes = new Map([...libres].map(([k, v]) => [k, [...v]]));
  return items.map((it) => {
    const token = (it.token ?? '').replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    let pacienteId = it.pacienteId ?? null;
    let por: ResultadoToken['por'] = pacienteId ? 'manual' : null;
    if (!pacienteId && porAfiliado.has(digitos(it.afiliado))) {
      pacienteId = porAfiliado.get(digitos(it.afiliado))!;
      por = 'afiliado';
    }
    if (!pacienteId && porDni.has(digitos(it.dni))) {
      pacienteId = porDni.get(digitos(it.dni))!;
      por = 'dni';
    }
    const r: ResultadoToken = {
      token,
      pacienteId,
      por,
      prestacionId: null,
      fecha: null,
      estado: 'ok',
    };
    if (!/^[0-9A-Z]{4,12}$/.test(token)) return { ...r, estado: 'invalido' };
    if (!pacienteId || !ids.has(pacienteId))
      return { ...r, estado: 'sin_paciente' };
    const suyos = usados.get(pacienteId) ?? new Set<string>();
    usados.set(pacienteId, suyos);
    if (suyos.has(token)) return { ...r, estado: 'duplicado' };
    suyos.add(token);
    const sesion = pendientes.get(pacienteId)?.shift();
    if (!sesion) return { ...r, estado: 'sin_sesion' };
    return { ...r, prestacionId: sesion.id, fecha: sesion.fecha };
  });
}

/**
 * Lee tokens pegados como texto: una línea por token, con el n.º de afiliado o
 * el DNI opcionales en la misma línea ("AB12CD 30111222").
 */
export function leerTokens(texto: string): ItemToken[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [token, ...resto] = l.split(/[\s,;]+/);
      const otro = resto.join('');
      const d = digitos(otro);
      // DNI: 7 u 8 dígitos (con puntos o sin); lo demás es el n.º de afiliado.
      return /^[\d.]+$/.test(otro) && d.length >= 7 && d.length <= 8
        ? { token: token!, dni: d }
        : { token: token!, afiliado: otro || null };
    });
}

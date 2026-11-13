/**
 * Grabaciones esperando señal, en IndexedDB. Cada una está cifrada con la clave
 * pública de la persona (cifrado.ts): ni el teléfono ni quien lo tenga puede
 * abrirla. Junto al paquete quedan solo ids, la fecha y la duración, sin datos
 * clínicos. Se borra apenas el servidor la transcribe bien. Sin IndexedDB (tests,
 * navegación privada sin almacenamiento), no se guarda nada y la grabación vive
 * solo en memoria.
 */

export interface Pendiente {
  id: string;
  centroId: string;
  usuarioId: string;
  pacienteId: string;
  turnoId: string | null;
  duracionSeg: number;
  /** ISO. */
  creadoEn: string;
  versionClave: number;
  paquete: ArrayBuffer;
  /** Intentos fallidos del lado del servidor (no cuentan los cortes de señal). */
  intentos: number;
  /**
   * Dictado ya subido. Si la señal se cortó mientras se transcribía, al volver se
   * consulta este trabajo en vez de subir la grabación otra vez (no se duplica el texto).
   */
  trabajoId?: string;
}

const BASE = 'ci-dictado';
const PENDIENTES = 'pendientes';

function abrir(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const pedido = indexedDB.open(BASE, 1);
    pedido.onupgradeneeded = () => {
      if (!pedido.result.objectStoreNames.contains(PENDIENTES)) {
        pedido.result.createObjectStore(PENDIENTES, { keyPath: 'id' });
      }
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => resolve(null);
  });
}

async function operar<T>(
  modo: IDBTransactionMode,
  accion: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await abrir();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const pedido = accion(db.transaction(PENDIENTES, modo).objectStore(PENDIENTES));
      pedido.onsuccess = () => resolve(pedido.result);
      pedido.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function guardarPendiente(p: Pendiente): Promise<boolean> {
  return (await operar('readwrite', (s) => s.put(p))) !== null;
}

/** Las de esta persona en este centro, de la más vieja a la más nueva. */
export async function listarPendientes(centroId: string, usuarioId: string): Promise<Pendiente[]> {
  const todas = (await operar<Pendiente[]>('readonly', (s) => s.getAll())) ?? [];
  return todas
    .filter((p) => p.centroId === centroId && p.usuarioId === usuarioId)
    .sort((a, b) => a.creadoEn.localeCompare(b.creadoEn));
}

export async function borrarPendiente(id: string): Promise<void> {
  await operar('readwrite', (s) => s.delete(id));
}

/** Al cerrar sesión: se borran las de esa persona (en todos sus centros). */
export async function borrarPendientesDe(usuarioId: string): Promise<void> {
  const todas = (await operar<Pendiente[]>('readonly', (s) => s.getAll())) ?? [];
  for (const p of todas.filter((x) => x.usuarioId === usuarioId)) await borrarPendiente(p.id);
}

// ───────── Clave pública guardada ─────────
// No es secreta: se guarda para poder cifrar aunque la app se abra sin señal.

const claveGuardada = (centroId: string, usuarioId: string) =>
  `ci-dictado-clave:${centroId}:${usuarioId}`;

export function leerClave(
  centroId: string,
  usuarioId: string,
): { version: number; clave: JsonWebKey } | null {
  try {
    const crudo = localStorage.getItem(claveGuardada(centroId, usuarioId));
    return crudo ? (JSON.parse(crudo) as { version: number; clave: JsonWebKey }) : null;
  } catch {
    return null;
  }
}

export function recordarClave(
  centroId: string,
  usuarioId: string,
  c: { version: number; clave: JsonWebKey },
): void {
  try {
    localStorage.setItem(claveGuardada(centroId, usuarioId), JSON.stringify(c));
  } catch {
    // Sin almacenamiento: se vuelve a pedir la próxima vez.
  }
}

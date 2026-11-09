import { minutos } from '../../core/fechas';

/** Rango visible del calendario. */
export const HORA_INICIO = 7;
export const HORA_FIN = 22;
export const PX_POR_HORA = 60;

export interface ConHorario {
  hora: string;
  horaFin: string;
}

export interface Bloque<T> {
  item: T;
  top: number;
  alto: number;
  /** Posición y ancho (en %) cuando hay turnos superpuestos en la misma columna. */
  izquierda: number;
  ancho: number;
}

/**
 * Ubica los elementos en la columna: posición vertical por horario y, si se
 * superponen (ej. dos profesionales a la misma hora en la vista semanal),
 * los reparte lado a lado.
 */
export function ubicarBloques<T extends ConHorario>(items: T[]): Bloque<T>[] {
  const inicioVisible = HORA_INICIO * 60;
  const finVisible = HORA_FIN * 60;
  const ordenados = [...items].sort((a, b) => minutos(a.hora) - minutos(b.hora));

  const bloques: Bloque<T>[] = [];
  let grupo: { item: T; ini: number; fin: number; carril: number }[] = [];
  let finGrupo = -1;

  const cerrarGrupo = () => {
    const carriles = Math.max(1, ...grupo.map((g) => g.carril + 1));
    for (const g of grupo) {
      const ini = Math.max(g.ini, inicioVisible);
      const fin = Math.min(g.fin, finVisible);
      if (fin <= ini) continue;
      bloques.push({
        item: g.item,
        top: ((ini - inicioVisible) / 60) * PX_POR_HORA,
        alto: Math.max(((fin - ini) / 60) * PX_POR_HORA, 18),
        izquierda: (g.carril / carriles) * 100,
        ancho: 100 / carriles,
      });
    }
    grupo = [];
  };

  for (const item of ordenados) {
    const ini = minutos(item.hora);
    // Si termina "antes" de empezar, cruza la medianoche: se corta al final del día.
    let fin = minutos(item.horaFin);
    if (fin <= ini) fin = 24 * 60;
    if (ini >= finGrupo) {
      cerrarGrupo();
      finGrupo = fin;
    } else {
      finGrupo = Math.max(finGrupo, fin);
    }
    const ocupados = new Set(grupo.filter((g) => g.fin > ini).map((g) => g.carril));
    let carril = 0;
    while (ocupados.has(carril)) carril++;
    grupo.push({ item, ini, fin, carril });
  }
  cerrarGrupo();
  return bloques;
}

/** Hora "HH:MM" (redondeada a 15 minutos) según la posición vertical en la columna. */
export function horaEnPosicion(y: number): string {
  const total = HORA_INICIO * 60 + Math.floor(((y / PX_POR_HORA) * 60) / 15) * 15;
  const acotado = Math.min(Math.max(total, HORA_INICIO * 60), HORA_FIN * 60 - 15);
  const h = String(Math.floor(acotado / 60)).padStart(2, '0');
  const m = String(acotado % 60).padStart(2, '0');
  return `${h}:${m}`;
}

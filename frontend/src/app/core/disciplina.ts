/**
 * Color de cada disciplina en Órbita Cian (tokens --oc-psi-*, --oc-to-*, …).
 * La disciplina es texto libre en la ficha del profesional; se reconoce por palabras.
 */
export type ColorDisciplina = 'psi' | 'to' | 'fono' | 'psicoped';

export function colorDisciplina(disciplina: string | null | undefined): ColorDisciplina {
  const d = (disciplina ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  if (d.includes('psicoped')) return 'psicoped';
  if (d.includes('fono')) return 'fono';
  if (d.includes('ocupacional') || /\bt\.? ?o\b/.test(d)) return 'to';
  return 'psi';
}

/** Iniciales para avatares: "Juana Gómez" → "JG". */
export function iniciales(...partes: (string | null | undefined)[]): string {
  return partes
    .flatMap((p) => (p ?? '').split(/\s+/))
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

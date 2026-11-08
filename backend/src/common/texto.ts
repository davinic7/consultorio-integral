/** Minúsculas y sin tildes ni diéresis ("Gómez Müller" → "gomez muller"). La ñ queda como n. */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/** Texto de búsqueda de un paciente: nombre, apellido, DNI y teléfono (también solo dígitos). */
export function textoBusquedaPaciente(p: {
  nombre: string;
  apellido: string;
  dni?: string | null;
  telefono?: string | null;
}): string {
  const telefonoDigitos = p.telefono?.replace(/\D/g, '');
  return normalizar(
    [p.nombre, p.apellido, p.dni, p.telefono, telefonoDigitos]
      .filter(Boolean)
      .join(' '),
  ).slice(0, 400);
}

/** Palabras a buscar, normalizadas. En las que son números se ignoran puntos y guiones (DNI). */
export function palabrasDeBusqueda(q: string | undefined): string[] {
  return normalizar(q ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5)
    .map((p) => (/^[\d.-]+$/.test(p) ? p.replace(/[.-]/g, '') : p));
}

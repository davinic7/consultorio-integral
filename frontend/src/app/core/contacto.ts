/**
 * Enlace de WhatsApp (wa.me) para un teléfono argentino, como en la referencia PHP
 * (app/lib/helpers.php): 54 9 + área + número. Sin código de área se asume 383
 * (Catamarca). Devuelve null si no parece un número válido.
 */
export function enlaceWhatsApp(telefono: string | null | undefined, area = '383'): string | null {
  let d = (telefono ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('549')) return d.length >= 12 ? `https://wa.me/${d}` : null;
  if (d.startsWith('54')) d = d.slice(2);
  d = d.replace(/^0/, '');
  // Celulares escritos con 15: área + 15 + número → área + número.
  const con15 = /^(\d{2,4})15(\d{6,8})$/.exec(d);
  if (con15 && con15[1].length + con15[2].length === 10) d = con15[1] + con15[2];
  if (d.length === 7) d = area + d;
  return d.length === 10 ? `https://wa.me/549${d}` : null;
}

/** Edad en años a partir de "AAAA-MM-DD". */
export function edad(fechaNacimiento: string | null | undefined, hoy = new Date()): number | null {
  if (!fechaNacimiento) return null;
  const [a, m, d] = fechaNacimiento.split('-').map(Number);
  let anios = hoy.getFullYear() - a;
  if (hoy.getMonth() + 1 < m || (hoy.getMonth() + 1 === m && hoy.getDate() < d)) anios--;
  return anios >= 0 ? anios : null;
}

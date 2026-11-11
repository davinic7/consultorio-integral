/**
 * Íconos de línea del menú (Órbita Cian): trazo de 1,5 px y `currentColor`.
 * Cada uno es el contenido interno de un <svg viewBox="0 0 24 24">.
 * Los de Panel, Agenda y Pacientes salen de docs/diseno/referencia/Panel.dc.html;
 * el de Cobros, de Cobros.dc.html.
 */
export const ICONOS = {
  panel:
    '<rect x="3" y="3" width="7" height="9" rx="2"/><rect x="14" y="3" width="7" height="5" rx="2"/><rect x="14" y="12" width="7" height="9" rx="2"/><rect x="3" y="16" width="7" height="5" rx="2"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  asistencia: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="m8 12 3 3 5-6"/>',
  pacientes:
    '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.8.7 3 2.5 3.5 5.2"/>',
  profesionales:
    '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.6-1.8 1.9-2.8 3.5-2.8s2.9 1 3.5 2.8M15 10h3M15 14h3"/>',
  salas: '<path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16M3 21h18"/><circle cx="15" cy="12" r="1"/>',
  cobros: '<rect x="3" y="6" width="18" height="14" rx="3"/><path d="M3 10h18M16 15h2"/>',
  financiadores: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6z"/><path d="M12 8v6M9 11h6"/>',
  plataforma:
    '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  presentacion: '<path d="M8 3h8l4 4v14H4V3h4z"/><path d="M8 12l3 3 5-6"/>',
  facturacion: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
  mas: '<path d="M4 7h16M4 12h16M4 17h16"/>',
} as const;

export type Icono = keyof typeof ICONOS;

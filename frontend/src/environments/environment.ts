/**
 * Producción. La web se sirve junto a la API, así que la URL es relativa.
 * Para la app móvil (Capacitor) apiUrl deberá ser absoluta.
 */
export const environment = {
  production: true,
  apiUrl: '/api/v1',
  /** Versión que se muestra al pie del menú. */
  version: '0.8',
};

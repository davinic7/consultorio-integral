import { Injectable } from '@angular/core';

const CLAVE = 'ci.refreshToken';

/**
 * Dónde se guarda el refresh token entre visitas. En la web, localStorage;
 * en la app móvil (Capacitor) se reemplaza por almacenamiento seguro del sistema.
 * El access token nunca se guarda: vive solo en memoria.
 */
@Injectable({ providedIn: 'root' })
export class TokenStorage {
  leer(): string | null {
    try {
      return localStorage.getItem(CLAVE);
    } catch {
      return null;
    }
  }

  guardar(token: string): void {
    try {
      localStorage.setItem(CLAVE, token);
    } catch {
      // Sin almacenamiento (modo privado): la sesión dura lo que la pestaña.
    }
  }

  borrar(): void {
    try {
      localStorage.removeItem(CLAVE);
    } catch {
      // nada que borrar
    }
  }
}

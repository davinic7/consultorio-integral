import { Injectable } from '@angular/core';

const CLAVE = 'ci.refreshToken';

/**
 * Dónde se guarda el refresh token entre visitas. En la web:
 * - "Recordarme en este equipo": localStorage (sobrevive a cerrar el navegador).
 * - Sin recordar: sessionStorage (la sesión termina al cerrar la pestaña).
 * En la app móvil (Capacitor) se reemplaza por almacenamiento seguro del sistema.
 * El access token nunca se guarda: vive solo en memoria.
 */
@Injectable({ providedIn: 'root' })
export class TokenStorage {
  /** Al renovar el token se mantiene el lugar elegido al iniciar sesión. */
  private persistente = !this.de(sessionStorage);

  /** Lo elige la pantalla de login antes de iniciar sesión. */
  recordar(si: boolean): void {
    this.persistente = si;
  }

  leer(): string | null {
    return this.de(localStorage) ?? this.de(sessionStorage);
  }

  guardar(token: string): void {
    this.borrar();
    try {
      (this.persistente ? localStorage : sessionStorage).setItem(CLAVE, token);
    } catch {
      // Sin almacenamiento (modo privado): la sesión dura lo que la pestaña.
    }
  }

  borrar(): void {
    for (const s of this.almacenes()) {
      try {
        s.removeItem(CLAVE);
      } catch {
        // nada que borrar
      }
    }
  }

  private de(s: Storage | undefined): string | null {
    try {
      return s?.getItem(CLAVE) ?? null;
    } catch {
      return null;
    }
  }

  private almacenes(): Storage[] {
    try {
      return [localStorage, sessionStorage];
    } catch {
      return [];
    }
  }
}

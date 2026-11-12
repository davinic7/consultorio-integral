import { Injectable } from '@angular/core';

const CLAVE = 'ci.refreshToken';
/** Lo que se guarda ahora: solo "hay una sesión", no el token. */
export const MARCA_SESION = 'cookie';

/**
 * Marca de que hay una sesión abierta, para saber si al abrir la app vale la pena
 * intentar renovarla. El refresh token de la web vive en una cookie httpOnly que
 * pone la API: el JavaScript de la página nunca lo ve.
 * - "Recordarme en este equipo": localStorage, y la cookie sobrevive a cerrar el navegador.
 * - Sin recordar: sessionStorage, y la cookie termina al cerrar el navegador.
 *
 * Si encuentra un refresh token guardado por una versión anterior, `leer()` lo
 * devuelve una vez para pasarlo a cookie.
 * En la app móvil (Capacitor) se reemplaza por almacenamiento seguro del sistema.
 * El access token nunca se guarda: vive solo en memoria.
 */
@Injectable({ providedIn: 'root' })
export class TokenStorage {
  /** Al renovar la sesión se mantiene lo elegido al iniciar sesión. */
  private persistente = !this.de(sessionStorage);

  /** Lo elige la pantalla de login antes de iniciar sesión. */
  recordar(si: boolean): void {
    this.persistente = si;
  }

  /** Si la sesión se recuerda en este equipo. */
  recuerda(): boolean {
    return this.persistente;
  }

  /** La marca de sesión, un token viejo para migrar, o null si no hay sesión. */
  leer(): string | null {
    return this.de(localStorage) ?? this.de(sessionStorage);
  }

  guardar(): void {
    this.borrar();
    try {
      (this.persistente ? localStorage : sessionStorage).setItem(CLAVE, MARCA_SESION);
    } catch {
      // Sin almacenamiento (modo privado): igual vale la cookie mientras dure la pestaña.
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

import { effect, Injectable, signal } from '@angular/core';

export type Tema = 'claro' | 'oscuro';

/**
 * Tema claro u oscuro (Órbita Cian). La elección se guarda en localStorage y se
 * aplica como `data-tema` en <html>. Sin elección guardada, sigue al dispositivo.
 */
@Injectable({ providedIn: 'root' })
export class TemaService {
  private readonly clave = 'ci-tema';
  private readonly consulta =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: light)') : null;

  /** Elección del usuario; null = la del dispositivo. */
  readonly tema = signal<Tema | null>(this.leer());
  /** Preferencia del dispositivo, al día si cambia mientras la app está abierta. */
  private readonly dispositivoClaro = signal(this.consulta?.matches ?? false);

  constructor() {
    this.consulta?.addEventListener('change', (e) => this.dispositivoClaro.set(e.matches));
    effect(() => {
      const t = this.tema();
      const html = document.documentElement;
      if (t) html.setAttribute('data-tema', t);
      else html.removeAttribute('data-tema');
      try {
        if (t) localStorage.setItem(this.clave, t);
        else localStorage.removeItem(this.clave);
      } catch {
        // Sin almacenamiento (modo privado): el tema vale solo para esta visita.
      }
    });
  }

  esOscuro(): boolean {
    const t = this.tema();
    return t ? t === 'oscuro' : !this.dispositivoClaro();
  }

  alternar(): void {
    this.tema.set(this.esOscuro() ? 'claro' : 'oscuro');
  }

  private leer(): Tema | null {
    try {
      const t = localStorage.getItem(this.clave);
      return t === 'claro' || t === 'oscuro' ? t : null;
    } catch {
      return null;
    }
  }
}

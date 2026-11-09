import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { AvisosApi } from './api/api';

const CADA_MS = 60_000;

/**
 * Contador de avisos sin leer, compartido por la barra y la pantalla de avisos.
 * Consulta cada minuto mientras la app está abierta.
 */
@Injectable({ providedIn: 'root' })
export class AvisosService {
  private readonly api = inject(AvisosApi);
  private timer: ReturnType<typeof setInterval> | null = null;

  readonly noLeidos = signal(0);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.detener());
  }

  iniciar(): void {
    if (this.timer) return;
    void this.actualizar();
    this.timer = setInterval(() => void this.actualizar(), CADA_MS);
  }

  detener(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.noLeidos.set(0);
  }

  async actualizar(): Promise<void> {
    try {
      this.noLeidos.set((await this.api.noLeidos()).noLeidos);
    } catch {
      // Sin conexión o sesión vencida: se reintenta en la próxima vuelta.
    }
  }
}

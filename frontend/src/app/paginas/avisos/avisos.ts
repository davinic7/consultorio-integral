import { Component, inject, OnInit, signal } from '@angular/core';
import { AvisosApi, mensajeDeError } from '../../core/api/api';
import type { Aviso } from '../../core/api/modelos';
import { AvisosService } from '../../core/avisos.service';

const ICONO: Record<Aviso['tipo'], string> = {
  turno_creado: '＋',
  turno_movido: '↔',
  turno_cancelado: '✕',
};

@Component({
  selector: 'app-avisos',
  templateUrl: './avisos.html',
})
export class Avisos implements OnInit {
  private readonly api = inject(AvisosApi);
  private readonly contador = inject(AvisosService);

  protected readonly avisos = signal<Aviso[]>([]);
  protected readonly noLeidos = signal(0);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly icono = ICONO;

  ngOnInit(): void {
    void this.cargar();
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      const r = await this.api.listar();
      this.avisos.set(r.items);
      this.noLeidos.set(r.noLeidos);
      this.contador.noLeidos.set(r.noLeidos);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar los avisos.'));
    } finally {
      this.cargando.set(false);
    }
  }

  protected async marcar(a: Aviso): Promise<void> {
    if (a.leidoEn) return;
    try {
      await this.api.marcarLeido(a.id);
      await this.cargar();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    }
  }

  protected async marcarTodos(): Promise<void> {
    try {
      await this.api.marcarTodos();
      await this.cargar();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    }
  }

  protected cuando(iso: string): string {
    return new Intl.DateTimeFormat('es-AR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(iso));
  }
}

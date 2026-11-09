import { Component, computed, inject, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { EstadoTurno, HistorialAsistencia } from '../../core/api/modelos';
import { NOMBRE_ESTADO } from '../../core/asistencia';
import { AuthService } from '../../core/auth/auth.service';
import { hoyEn } from '../../core/fechas';

/** Clase de estado Órbita (siempre con texto, nunca solo color). */
export const CLASE_ESTADO: Record<EstadoTurno, string> = {
  pendiente: '',
  presente: 'oc-estado--ok',
  ausente_con_aviso: 'oc-estado--aviso',
  ausente_sin_aviso: 'oc-estado--error',
  cancelado_profesional: '',
};

/** Pestaña "Sesiones" de la ficha: turnos con su asistencia y la planilla mensual. */
@Component({
  selector: 'app-asistencia-paciente',
  imports: [FormsModule, RouterLink],
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    .planilla {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 0.75rem;
    }
    .planilla h2 {
      flex: 1 0 100%;
      margin: 0;
      font: var(--oc-t-subtitulo);
    }
  `,
  template: `
    @if (historial(); as h) {
      <div class="oc-tabla-caja">
        <table class="oc-tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Hora</th>
              <th>Profesional</th>
              <th>Sala</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            @for (t of h.turnos; track t.id) {
              <tr>
                <td class="oc-mono">{{ fechaCorta(t.fecha) }}</td>
                <td class="oc-mono">{{ t.hora }}</td>
                <td>{{ t.profesional.apellido }}, {{ t.profesional.nombre }}</td>
                <td class="oc-suave">{{ t.sala?.nombre ?? '—' }}</td>
                <td>
                  <span class="oc-estado" [class]="claseEstado[t.estado]">{{
                    nombreEstado[t.estado]
                  }}</span>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="5" class="oc-suave">Sin turnos en este período.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="oc-suave">Del {{ fechaCorta(h.desde) }} al {{ fechaCorta(h.hasta) }}.</p>

      <section class="oc-tarjeta planilla" aria-label="Planilla mensual">
        <h2>Planilla mensual para firmar</h2>
        <label class="oc-campo">
          Mes
          <input type="month" [(ngModel)]="mes" />
        </label>
        @if (profesionales().length > 1) {
          <label class="oc-campo">
            Profesional
            <select [(ngModel)]="profesionalId">
              <option value="">Todos</option>
              @for (p of profesionales(); track p.id) {
                <option [value]="p.id">{{ p.apellido }}, {{ p.nombre }}</option>
              }
            </select>
          </label>
        }
        <a
          class="oc-btn"
          [routerLink]="['/pacientes', pacienteId(), 'planilla']"
          [queryParams]="{ mes: mes || null, profesionalId: profesionalId || null }"
        >
          Ver planilla
        </a>
      </section>
    }
  `,
})
export class AsistenciaPaciente {
  readonly pacienteId = input.required<string>();
  readonly historial = input.required<HistorialAsistencia | null>();

  private readonly auth = inject(AuthService);

  protected readonly nombreEstado = NOMBRE_ESTADO;
  protected readonly claseEstado = CLASE_ESTADO;
  /** "2026-05-13" → "13/05/2026". */
  protected readonly fechaCorta = (f: string) => f.split('-').reverse().join('/');

  protected mes = hoyEn(this.auth.sesion()?.centro?.zonaHoraria).slice(0, 7);
  protected profesionalId = '';

  /** Profesionales que aparecen en el historial (para filtrar la planilla). */
  protected readonly profesionales = computed(() => {
    const vistos = new Map<string, { id: string; nombre: string; apellido: string }>();
    for (const t of this.historial()?.turnos ?? []) vistos.set(t.profesional.id, t.profesional);
    return [...vistos.values()];
  });
}

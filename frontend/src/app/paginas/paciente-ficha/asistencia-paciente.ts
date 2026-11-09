import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AsistenciaApi, mensajeDeError } from '../../core/api/api';
import type { HistorialAsistencia } from '../../core/api/modelos';
import { NOMBRE_ESTADO } from '../../core/asistencia';
import { AuthService } from '../../core/auth/auth.service';
import { fechaLarga, hoyEn } from '../../core/fechas';

/** Historial de asistencia del paciente y acceso a la planilla mensual. */
@Component({
  selector: 'app-asistencia-paciente',
  imports: [FormsModule, RouterLink],
  template: `
    <section class="panel" aria-labelledby="titulo-asistencia">
      <h2 id="titulo-asistencia">Asistencia</h2>

      @if (cargando()) {
        <p class="sutil">Cargando…</p>
      } @else if (error(); as mensaje) {
        <p class="aviso aviso--error" role="alert">{{ mensaje }}</p>
      } @else if (historial(); as h) {
        <div class="resumen-asistencia">
          <span>
            <span class="estado-turno" data-estado="presente">Presente</span>
            {{ h.resumen.presente }}
          </span>
          <span>
            <span class="estado-turno" data-estado="ausente_con_aviso">Ausente con aviso</span>
            {{ h.resumen.ausente_con_aviso }}
          </span>
          <span>
            <span class="estado-turno" data-estado="ausente_sin_aviso">Ausente sin aviso</span>
            {{ h.resumen.ausente_sin_aviso }}
          </span>
          @if (h.resumen.porcentajeAsistencia !== null) {
            <strong>Asistencia: {{ h.resumen.porcentajeAsistencia }}%</strong>
          }
        </div>
        <p class="sutil">
          Del {{ fechaCorta(h.desde) }} al {{ fechaCorta(h.hasta) }}. El porcentaje cuenta los
          turnos ya marcados.
        </p>

        @if (h.turnos.length) {
          <ul class="lista">
            @for (t of h.turnos; track t.id) {
              <li class="lista__item">
                <span>
                  <strong>{{ fechaLarga(t.fecha) }}</strong> · {{ t.hora }}
                  <span class="sutil">
                    · {{ t.profesional.apellido }}, {{ t.profesional.nombre }}
                  </span>
                </span>
                <span class="estado-turno" [attr.data-estado]="t.estado">
                  {{ nombreEstado[t.estado] }}
                </span>
              </li>
            }
          </ul>
        } @else {
          <p class="sutil">Sin turnos en este período.</p>
        }

        <h3>Planilla mensual para firmar</h3>
        <div class="form-linea">
          <label class="campo">
            <span>Mes</span>
            <input type="month" [(ngModel)]="mes" />
          </label>
          @if (profesionales().length > 1) {
            <label class="campo">
              <span>Profesional</span>
              <select [(ngModel)]="profesionalId">
                <option value="">Todos</option>
                @for (p of profesionales(); track p.id) {
                  <option [value]="p.id">{{ p.apellido }}, {{ p.nombre }}</option>
                }
              </select>
            </label>
          }
          <a
            class="boton"
            [routerLink]="['/pacientes', pacienteId(), 'planilla']"
            [queryParams]="{ mes: mes || null, profesionalId: profesionalId || null }"
          >
            Ver planilla
          </a>
        </div>
      }
    </section>
  `,
})
export class AsistenciaPaciente implements OnInit {
  readonly pacienteId = input.required<string>();

  private readonly api = inject(AsistenciaApi);
  private readonly auth = inject(AuthService);

  protected readonly historial = signal<HistorialAsistencia | null>(null);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly nombreEstado = NOMBRE_ESTADO;
  protected readonly fechaLarga = fechaLarga;
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

  async ngOnInit(): Promise<void> {
    try {
      this.historial.set(await this.api.historial(this.pacienteId()));
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo cargar la asistencia.'));
    } finally {
      this.cargando.set(false);
    }
  }
}

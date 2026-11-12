import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensajeDeError, ReglaFaltazoApi } from '../../core/api/api';
import type { Profesional, ReglaFaltazo } from '../../core/api/modelos';

/**
 * Regla de faltazo de un profesional: la decide él (o la administración por él).
 * Apagada por defecto. Solo se cobra a pacientes particulares, nunca a una obra
 * social, y el cobro se puede anular con motivo.
 */
@Component({
  selector: 'app-regla-faltazo',
  imports: [FormsModule],
  styles: `
    .grilla {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
      gap: 0.75rem 1rem;
    }
    .acciones {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
    }
  `,
  template: `
    <section class="oc-tarjeta" aria-labelledby="fal-t">
      <h2 id="fal-t">Faltazos · {{ profesional().apellido }}, {{ profesional().nombre }}</h2>
      <p class="oc-suave">
        Si la activás, cuando un paciente particular falta sin avisar (o avisa con menos
        anticipación que la tolerancia) queda un cobro pendiente. Recepción o vos lo pueden anular
        con un motivo. Nunca se cobra a una obra social.
      </p>
      @if (regla(); as r) {
        <form (ngSubmit)="guardar()">
          <label class="oc-check">
            <input type="checkbox" name="activo" [(ngModel)]="r.activo" />
            Cobrar los faltazos
          </label>
          @if (r.activo) {
            <div class="grilla">
              <label class="oc-campo">
                <span>Tolerancia (horas de aviso)</span>
                <input
                  type="number"
                  min="0"
                  max="168"
                  step="1"
                  name="tol"
                  [(ngModel)]="r.toleranciaHoras"
                />
              </label>
              <label class="oc-campo">
                <span>Qué se cobra</span>
                <select name="modo" [(ngModel)]="r.modo">
                  <option value="completa">La sesión completa</option>
                  <option value="mitad">La mitad de la sesión</option>
                  <option value="fijo">Un monto fijo</option>
                </select>
              </label>
              @if (r.modo === 'fijo') {
                <label class="oc-campo">
                  <span>Monto ($)</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    name="monto"
                    [(ngModel)]="r.monto"
                    required
                  />
                </label>
              }
            </div>
          }
          @if (error(); as mensaje) {
            <p class="oc-alerta oc-alerta--error" role="alert">{{ mensaje }}</p>
          }
          @if (guardado()) {
            <p class="oc-alerta oc-alerta--ok" role="status">Regla guardada.</p>
          }
          <div class="acciones">
            <button type="submit" class="oc-btn oc-btn--primario" [disabled]="ocupado()">
              Guardar
            </button>
            <button type="button" class="oc-btn oc-btn--chico" (click)="cerrado.emit()">
              Cerrar
            </button>
          </div>
        </form>
      } @else if (error(); as mensaje) {
        <p class="oc-alerta oc-alerta--error" role="alert">{{ mensaje }}</p>
      } @else {
        <p class="oc-suave">Cargando…</p>
      }
    </section>
  `,
})
export class ReglaFaltazoForm implements OnInit {
  readonly profesional = input.required<Profesional>();
  readonly cerrado = output<void>();
  /** Avisa la regla guardada (para actualizar la lista). */
  readonly guardada = output<ReglaFaltazo>();

  private readonly api = inject(ReglaFaltazoApi);
  protected readonly regla = signal<ReglaFaltazo | null>(null);
  protected readonly ocupado = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly guardado = signal(false);

  async ngOnInit(): Promise<void> {
    try {
      this.regla.set(await this.api.obtener(this.profesional().id));
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo cargar la regla.'));
    }
  }

  protected async guardar(): Promise<void> {
    const r = this.regla();
    if (!r) return;
    this.ocupado.set(true);
    this.error.set(null);
    this.guardado.set(false);
    try {
      const datos: ReglaFaltazo = {
        activo: r.activo,
        toleranciaHoras: Number(r.toleranciaHoras),
        modo: r.modo,
        monto: r.modo === 'fijo' && r.monto !== null ? Number(r.monto) : null,
      };
      const guardada = await this.api.guardar(this.profesional().id, datos);
      this.regla.set(guardada);
      this.guardado.set(true);
      this.guardada.emit(guardada);
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.ocupado.set(false);
    }
  }
}

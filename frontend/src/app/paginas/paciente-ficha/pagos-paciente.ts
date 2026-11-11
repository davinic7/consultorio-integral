import { Component, computed, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { mensajeDeError, OrdenesApi } from '../../core/api/api';
import type { Orden, Paciente, Prestacion } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { puede } from '../../core/auth/roles';
import { CLASE_COBRO, NOMBRE_AVISO, NOMBRE_COBRO, plata } from '../../core/cobros';
import { DetalleCobro } from '../cobros/detalle-cobro';

const fechaCorta = (f: string | null) => (f ? f.split('-').reverse().join('/') : '—');

/**
 * Pestaña "Pagos" de la ficha: sesiones asistidas con su cobro (con el detalle
 * para cobrar) y las órdenes de la obra social, si las pide.
 */
@Component({
  selector: 'app-pagos-paciente',
  imports: [ReactiveFormsModule, DetalleCobro],
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
    h2 {
      margin: 0 0 0.75rem;
      font: var(--oc-t-subtitulo);
    }
    .num {
      text-align: right !important;
      white-space: nowrap;
    }
    .nota {
      font-size: 0.75rem;
    }
    .avisos {
      color: var(--oc-aviso-texto);
      font-size: 0.6875rem;
    }
    .ordenes {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin: 0 0 1rem;
      padding: 0;
      list-style: none;
    }
    .ordenes li {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 1rem;
      padding: 0.625rem 0.875rem;
      border: 1px solid var(--oc-borde);
      border-radius: var(--oc-radio-chico);
      font-size: 0.8125rem;
    }
    .ordenes .enlace {
      margin-left: auto;
    }
    form {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      align-items: end;
      gap: 0.75rem;
    }
  `,
  template: `
    @if (muestraOrdenes()) {
      <section class="oc-tarjeta" aria-labelledby="ord-t">
        <h2 id="ord-t">Órdenes de {{ financiador()?.nombre ?? 'la obra social' }}</h2>
        <ul class="ordenes">
          @for (o of ordenes(); track o.id) {
            <li>
              <b class="oc-mono">{{ o.numero }}</b>
              <span
                >Emitida {{ fechaCorta(o.fechaEmision)
                }}{{ o.vence ? ', vence ' + fechaCorta(o.vence) : '' }}</span
              >
              <span class="oc-mono">{{ o.usadas }}/{{ o.sesiones }} sesiones</span>
              <span
                class="oc-estado"
                [class.oc-estado--ok]="o.vigente && o.disponibles"
                [class.oc-estado--aviso]="o.vigente && !o.disponibles"
              >
                {{
                  !o.vigente
                    ? 'Fuera de fecha'
                    : o.disponibles === 1
                      ? '1 libre'
                      : o.disponibles
                        ? o.disponibles + ' libres'
                        : 'Completa'
                }}
              </span>
              @if (gestiona() && !o.usadas) {
                <button type="button" class="enlace" (click)="borrarOrden(o)">Borrar</button>
              }
            </li>
          } @empty {
            <li class="oc-suave">Todavía no hay órdenes cargadas.</li>
          }
        </ul>
        @if (gestiona() && financiador(); as f) {
          <form [formGroup]="form" (ngSubmit)="crearOrden(f.id)" novalidate>
            <label class="oc-campo">
              N.º de orden
              <input formControlName="numero" autocomplete="off" />
            </label>
            <label class="oc-campo">
              Emitida el
              <input type="date" formControlName="fechaEmision" />
            </label>
            <label class="oc-campo">
              Sesiones
              <input type="number" min="1" max="100" formControlName="sesiones" />
            </label>
            <label class="oc-campo">
              Vence (opcional)
              <input type="date" formControlName="vence" />
            </label>
            <button type="submit" class="oc-btn oc-btn--primario" [disabled]="guardando()">
              Agregar orden
            </button>
          </form>
          <p class="oc-suave nota">
            Sin vencimiento, se calcula con la validez de la obra social. La orden nueva se asigna
            sola a las sesiones que la esperaban.
          </p>
        }
        @if (error(); as e) {
          <p class="oc-alerta oc-alerta--error" role="alert">{{ e }}</p>
        }
      </section>
    }

    <section aria-labelledby="ses-pag-t">
      <h2 id="ses-pag-t">Sesiones y pagos</h2>
      <div class="oc-tabla-caja">
        <table class="oc-tabla">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Profesional</th>
              <th>Cobertura</th>
              <th class="num">Monto</th>
              <th>Estado</th>
              <th><span class="visualmente-oculto">Detalle</span></th>
            </tr>
          </thead>
          <tbody>
            @for (p of prestaciones(); track p.id) {
              <tr>
                <td class="oc-mono">{{ fechaCorta(p.fecha) }}</td>
                <td>{{ p.profesional.apellido }}</td>
                <td>
                  {{ p.financiador?.nombre ?? 'Particular' }}
                  @if (p.avisos.length) {
                    <div class="avisos">{{ textoAvisos(p) }}</div>
                  }
                </td>
                <td class="num oc-mono">
                  {{ plata(p.monto) }}
                  @if (p.saldo > 0 && p.estadoCobro !== 'pendiente') {
                    <div class="oc-suave nota">debe {{ plata(p.saldo) }}</div>
                  }
                </td>
                <td>
                  <span [class]="claseCobro[p.estadoCobro]">{{ nombreCobro[p.estadoCobro] }}</span>
                </td>
                <td>
                  <button type="button" class="oc-btn oc-btn--chico" (click)="detalle.set(p)">
                    {{ gestiona() && p.saldo > 0 ? 'Cobrar' : 'Ver' }}
                  </button>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="6" class="oc-suave">Todavía no hay sesiones presentes para cobrar.</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>

    <app-detalle-cobro [(prestacion)]="detalle" (cambio)="cambio.emit()" />
  `,
})
export class PagosPaciente {
  readonly pacienteId = input.required<string>();
  readonly financiador = input<Paciente['financiador']>(null);
  readonly prestaciones = input<Prestacion[]>([]);
  readonly ordenes = input<Orden[]>([]);
  /** Algo cambió: la ficha recarga cobros y órdenes. */
  readonly cambio = output<void>();

  private readonly api = inject(OrdenesApi);
  private readonly auth = inject(AuthService);

  protected readonly gestiona = computed(() =>
    puede(this.auth.sesion()?.rol, 'admin', 'recepcion'),
  );
  protected readonly muestraOrdenes = computed(
    () => !!this.financiador()?.requiereOrden || this.ordenes().length > 0,
  );
  protected readonly detalle = signal<Prestacion | null>(null);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly plata = plata;
  protected readonly nombreCobro = NOMBRE_COBRO;
  protected readonly claseCobro = CLASE_COBRO;
  protected readonly fechaCorta = fechaCorta;
  protected textoAvisos(p: Prestacion): string {
    return p.avisos.map((a) => NOMBRE_AVISO[a]).join(' · ');
  }

  protected readonly form = inject(NonNullableFormBuilder).group({
    numero: ['', [Validators.required, Validators.maxLength(40)]],
    fechaEmision: ['', Validators.required],
    sesiones: [4, [Validators.required, Validators.min(1), Validators.max(100)]],
    vence: [''],
  });

  protected async crearOrden(financiadorId: string): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.error.set('Completá el número, la fecha de emisión y las sesiones.');
      return;
    }
    const v = this.form.getRawValue();
    this.guardando.set(true);
    this.error.set(null);
    try {
      await this.api.crear({
        pacienteId: this.pacienteId(),
        financiadorId,
        numero: v.numero.trim(),
        fechaEmision: v.fechaEmision,
        sesiones: Number(v.sesiones),
        ...(v.vence ? { vence: v.vence } : {}),
      });
      this.form.reset({ numero: '', fechaEmision: '', sesiones: 4, vence: '' });
      this.cambio.emit();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async borrarOrden(o: Orden): Promise<void> {
    this.error.set(null);
    try {
      await this.api.borrar(o.id);
      this.cambio.emit();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    }
  }
}

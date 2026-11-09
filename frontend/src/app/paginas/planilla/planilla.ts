import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { AsistenciaApi, mensajeDeError } from '../../core/api/api';
import type { Planilla as DatosPlanilla } from '../../core/api/modelos';
import { NOMBRE_ESTADO } from '../../core/asistencia';
import { AuthService } from '../../core/auth/auth.service';
import { diaSemana, hoyEn, NOMBRE_DIA } from '../../core/fechas';

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

/** "2026-11" ± n meses. */
function moverMes(mes: string, n: number): string {
  const [a, m] = mes.split('-').map(Number);
  const total = a * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/**
 * Planilla mensual de asistencia por paciente, lista para imprimir y firmar a mano:
 * fechas de los turnos precargadas y datos del financiador.
 */
@Component({
  selector: 'app-planilla',
  imports: [RouterLink],
  styles: `
    .planilla {
      max-width: 60rem;
      margin: 0 auto;
    }
    .planilla__cabecera {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0.5rem 2rem;
      margin-bottom: 1rem;
    }
    .planilla__datos {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.25rem 1rem;
      margin: 0;
    }
    .planilla__datos dt {
      font-weight: 600;
    }
    .planilla__datos dd {
      margin: 0;
    }
    .tabla-contenedor {
      overflow-x: auto;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--oc-panel);
    }
    th,
    td {
      border: 1px solid var(--oc-borde);
      padding: 0.45rem 0.5rem;
      text-align: left;
      vertical-align: top;
    }
    td.firma {
      min-width: 10rem;
      height: 2.2rem;
    }
    .firmas {
      display: flex;
      flex-wrap: wrap;
      gap: 2rem 4rem;
      margin-top: 3rem;
    }
    .firmas div {
      flex: 1 1 14rem;
      border-top: 1px solid var(--oc-texto);
      padding-top: 0.25rem;
      text-align: center;
    }
    @media print {
      .planilla {
        max-width: none;
      }
      th,
      td {
        border-color: #000;
      }
    }
  `,
  template: `
    <main class="oc-contenido planilla">
      <div class="no-imprimir acciones">
        <a [routerLink]="['/pacientes', id()]" class="volver">← Ficha del paciente</a>
        <button type="button" class="enlace" (click)="irA(-1)">← Mes anterior</button>
        <button type="button" class="enlace" (click)="irA(1)">Mes siguiente →</button>
        <button type="button" class="oc-btn oc-btn--primario" (click)="imprimir()" [disabled]="!datos()">
          Imprimir
        </button>
      </div>

      @if (cargando()) {
        <p class="oc-suave">Cargando…</p>
      } @else if (error(); as mensaje) {
        <p class="oc-alerta oc-alerta--error" role="alert">{{ mensaje }}</p>
      } @else if (datos(); as d) {
        <div class="planilla__cabecera">
          <div>
            <h1>Planilla de asistencia</h1>
            <p>{{ d.centro }} · {{ nombreMes() }}</p>
          </div>
          <dl class="planilla__datos">
            <dt>Paciente</dt>
            <dd>{{ d.paciente.apellido }}, {{ d.paciente.nombre }}</dd>
            <dt>DNI</dt>
            <dd>{{ d.paciente.dni ?? '—' }}</dd>
            <dt>Obra social / financiador</dt>
            <dd>
              {{ d.paciente.financiador?.nombre ?? 'Particular' }}
              @if (d.paciente.tieneCud) {
                · CUD
              }
            </dd>
            <dt>N.º de afiliado</dt>
            <dd>{{ d.paciente.nroAfiliado ?? '—' }}</dd>
            <dt>Profesional</dt>
            <dd>
              @for (p of d.profesionales; track p.id; let ultimo = $last) {
                {{ p.apellido }}, {{ p.nombre }} ({{ p.disciplina }}){{ ultimo ? '' : ' · ' }}
              } @empty {
                —
              }
            </dd>
          </dl>
        </div>

        @if (d.filas.length) {
          <div class="oc-tabla-caja">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Hora</th>
                  @if (d.profesionales.length > 1) {
                    <th>Profesional</th>
                  }
                  <th>Asistencia</th>
                  <th>Firma del paciente o responsable</th>
                </tr>
              </thead>
              <tbody>
                @for (f of d.filas; track f.turnoId) {
                  <tr>
                    <td>{{ dia(f.fecha) }}</td>
                    <td>{{ f.hora }} a {{ f.horaFin }}</td>
                    @if (d.profesionales.length > 1) {
                      <td>{{ f.profesional.apellido }}</td>
                    }
                    <td>{{ f.estado === 'pendiente' ? '' : nombreEstado[f.estado] }}</td>
                    <td class="firma"></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="firmas">
            <div>Firma y sello del profesional</div>
            <div>Firma del paciente o responsable</div>
          </div>
        } @else {
          <p class="oc-alerta oc-alerta--aviso">No hay turnos agendados en {{ nombreMes() }}.</p>
        }
      }
    </main>
  `,
})
export class Planilla {
  /** De la ruta: /pacientes/:id/planilla?mes=AAAA-MM&profesionalId=… */
  readonly id = input.required<string>();
  readonly mes = input<string>();
  readonly profesionalId = input<string>();

  private readonly api = inject(AsistenciaApi);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly datos = signal<DatosPlanilla | null>(null);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly nombreEstado = NOMBRE_ESTADO;

  private readonly mesElegido = computed(
    () => this.mes() || hoyEn(this.auth.sesion()?.centro?.zonaHoraria).slice(0, 7),
  );
  protected readonly nombreMes = computed(() => {
    const [a, m] = this.mesElegido().split('-').map(Number);
    return `${MESES[m - 1]} de ${a}`;
  });

  constructor() {
    effect(() => {
      void this.cargar(this.id(), this.mesElegido(), this.profesionalId());
    });
  }

  protected dia(fecha: string): string {
    const [, m, d] = fecha.split('-');
    return `${NOMBRE_DIA[diaSemana(fecha) - 1]} ${d}/${m}`;
  }

  protected irA(n: number): void {
    void this.router.navigate([], {
      queryParams: { mes: moverMes(this.mesElegido(), n) },
      queryParamsHandling: 'merge',
    });
  }

  protected imprimir(): void {
    window.print();
  }

  private async cargar(id: string, mes: string, profesionalId?: string): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.datos.set(await this.api.planilla(id, mes, profesionalId || undefined));
    } catch (e) {
      this.datos.set(null);
      this.error.set(mensajeDeError(e, 'No se pudo armar la planilla.'));
    } finally {
      this.cargando.set(false);
    }
  }
}

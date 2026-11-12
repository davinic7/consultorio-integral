import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { CobrosApi, LiquidacionesApi, mensajeDeError } from '../../core/api/api';
import type { LiquidacionProfesional, Prestacion } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import {
  NOMBRE_LIQUIDACION,
  nombreMes,
  plata,
  sumarMes,
  textoComponente,
  textoSaldo,
} from '../../core/cobros';
import { diaSemana, hoyEn, NOMBRE_DIA } from '../../core/fechas';

/** Texto corto del comprobante para mandar por WhatsApp. */
export function textoComprobante(centro: string, mes: string, l: LiquidacionProfesional): string {
  return [
    `${centro} · Liquidación de ${nombreMes(mes)}`,
    `${l.profesional.nombre} ${l.profesional.apellido} (${l.profesional.disciplina})`,
    `Sesiones: ${l.sesiones}`,
    ...(l.faltazos ? [`Faltazos cobrables (${l.faltazos}): ${plata(l.montoFaltazos)}`] : []),
    `Facturado: ${plata(l.facturado)}`,
    ...l.componentes.map((c) => `Alquiler · ${textoComponente(c)}: − ${plata(c.monto)}`),
    `Alquiler total: ${plata(l.alquiler)}`,
    ...(l.cobraElCentro ? [] : ['Cobra el profesional: lo facturado no pasa por el centro']),
    `${textoSaldo(l.saldo, false)}: ${plata(Math.abs(l.saldo))}`,
  ].join('\n');
}

/**
 * Comprobante de liquidación de un profesional para un mes: detalle de las sesiones,
 * totales y firmas. Para imprimir (o guardar como PDF) y mandar al profesional.
 */
@Component({
  selector: 'app-comprobante-liquidacion',
  imports: [RouterLink],
  styles: `
    .comprobante {
      max-width: 60rem;
      margin: 0 auto;
    }
    .comprobante__cabecera {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      gap: 0.5rem 2rem;
      margin-bottom: 1rem;
    }
    .comprobante__datos {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.25rem 1rem;
      margin: 0;
    }
    .comprobante__datos dt {
      font-weight: 600;
    }
    .comprobante__datos dd {
      margin: 0;
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
    }
    td.monto,
    th.monto {
      text-align: right;
      white-space: nowrap;
    }
    .totales {
      display: grid;
      grid-template-columns: 1fr max-content;
      gap: 0.35rem 2rem;
      max-width: 26rem;
      margin: 1rem 0 0 auto;
    }
    .totales dd {
      margin: 0;
      text-align: right;
    }
    .totales .total {
      font-weight: 700;
      font-size: 1.05rem;
      border-top: 1px solid var(--oc-borde);
      padding-top: 0.35rem;
    }
    .firmas {
      display: flex;
      flex-wrap: wrap;
      gap: 2rem 4rem;
      margin-top: 3.5rem;
    }
    .firmas div {
      flex: 1 1 14rem;
      border-top: 1px solid var(--oc-texto);
      padding-top: 0.25rem;
      text-align: center;
    }
    @media print {
      .comprobante {
        max-width: none;
      }
      th,
      td {
        border-color: #000;
      }
    }
  `,
  template: `
    <main class="oc-contenido comprobante">
      <div class="no-imprimir acciones">
        <a routerLink="/cobros" class="volver">← Cobros y liquidación</a>
        <button type="button" class="enlace" (click)="irA(-1)">← Mes anterior</button>
        <button type="button" class="enlace" (click)="irA(1)">Mes siguiente →</button>
        <button
          type="button"
          class="oc-btn oc-btn--primario"
          (click)="imprimir()"
          [disabled]="!liquidacion()"
        >
          Imprimir o guardar PDF
        </button>
        @if (enlaceWhatsApp(); as enlace) {
          <a class="oc-btn" [href]="enlace" target="_blank" rel="noopener">Mandar por WhatsApp</a>
        }
      </div>

      @if (cargando()) {
        <p class="oc-suave">Cargando…</p>
      } @else if (error(); as mensaje) {
        <p class="oc-alerta oc-alerta--error" role="alert">{{ mensaje }}</p>
      } @else if (liquidacion(); as l) {
        <div class="comprobante__cabecera">
          <div>
            <h1>Comprobante de liquidación</h1>
            <p>{{ centro() }} · {{ titulo() }}</p>
          </div>
          <dl class="comprobante__datos">
            <dt>Profesional</dt>
            <dd>{{ l.profesional.apellido }}, {{ l.profesional.nombre }}</dd>
            <dt>Disciplina</dt>
            <dd>{{ l.profesional.disciplina }}</dd>
            <dt>Estado</dt>
            <dd>{{ l.liquidacion ? nombreLiquidacion[l.liquidacion.estado] : 'Sin generar' }}</dd>
            @if (l.liquidacion?.pagadaEn; as pagada) {
              <dt>Pagada el</dt>
              <dd>{{ fecha(pagada) }}</dd>
            }
          </dl>
        </div>

        @if (!l.liquidacion || l.liquidacion.estado === 'borrador') {
          <p class="oc-alerta oc-alerta--aviso">
            Borrador: la liquidación de este mes todavía no está generada y los montos pueden
            cambiar.
          </p>
        }

        @if (sesiones().length) {
          <div class="oc-tabla-caja">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Hora</th>
                  <th>Paciente</th>
                  <th>Cobertura</th>
                  <th class="monto">Valor</th>
                </tr>
              </thead>
              <tbody>
                @for (s of sesiones(); track s.id) {
                  <tr>
                    <td>{{ dia(s.fecha) }}</td>
                    <td>{{ s.hora }}</td>
                    <td>{{ s.paciente.apellido }}, {{ s.paciente.nombre }}</td>
                    <td>{{ s.financiador?.nombre ?? 'Particular' }}</td>
                    <td class="monto oc-mono">{{ plata(s.monto) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        } @else {
          <p class="oc-suave">No hay sesiones registradas en {{ titulo() }}.</p>
        }

        <dl class="totales">
          <dt>Sesiones</dt>
          <dd class="oc-mono">{{ l.sesiones }}</dd>
          @if (l.faltazos) {
            <dt>Faltazos cobrables ({{ l.faltazos }})</dt>
            <dd class="oc-mono">{{ plata(l.montoFaltazos) }}</dd>
          }
          <dt>Facturado</dt>
          <dd class="oc-mono">{{ plata(l.facturado) }}</dd>
          @for (c of l.componentes; track $index) {
            <dt>Alquiler · {{ textoComponente(c) }}</dt>
            <dd class="oc-mono">− {{ plata(c.monto) }}</dd>
          }
          <dt>
            Alquiler del mes
            @if (l.acuerdo?.vigenteDesde; as desde) {
              <span class="oc-suave">(acuerdo desde {{ nombreMes(desde) }})</span>
            } @else if (!l.acuerdo) {
              <span class="oc-suave">(sin acuerdo)</span>
            }
          </dt>
          <dd class="oc-mono">− {{ plata(l.alquiler) }}</dd>
          @if (!l.cobraElCentro) {
            <dt>Cobra el profesional</dt>
            <dd class="oc-mono">− {{ plata(l.facturado) }}</dd>
          }
          <dt class="total">{{ textoSaldo(l.saldo, false) }}</dt>
          <dd class="total oc-mono">{{ plata(abs(l.saldo)) }}</dd>
        </dl>

        <div class="firmas">
          <div>Firma por el centro</div>
          <div>Firma del profesional (recibí conforme)</div>
        </div>
      } @else {
        <p class="oc-alerta oc-alerta--aviso">
          No hay liquidación de este profesional en {{ titulo() }}.
        </p>
      }
    </main>
  `,
})
export class ComprobanteLiquidacion {
  /** De la ruta: /cobros/liquidacion/:profesionalId?mes=AAAA-MM */
  readonly profesionalId = input.required<string>();
  readonly mes = input<string>();

  private readonly liquidaciones = inject(LiquidacionesApi);
  private readonly cobros = inject(CobrosApi);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly liquidacion = signal<LiquidacionProfesional | null>(null);
  protected readonly sesiones = signal<Prestacion[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly plata = plata;
  protected readonly nombreMes = nombreMes;
  protected readonly textoComponente = textoComponente;
  protected readonly textoSaldo = textoSaldo;
  protected readonly abs = Math.abs;
  protected readonly nombreLiquidacion = NOMBRE_LIQUIDACION;

  protected readonly centro = computed(() => this.auth.sesion()?.centro?.nombre ?? '');
  private readonly mesElegido = computed(
    () => this.mes() || hoyEn(this.auth.sesion()?.centro?.zonaHoraria).slice(0, 7),
  );
  protected readonly titulo = computed(() => nombreMes(this.mesElegido()));
  protected readonly enlaceWhatsApp = computed(() => {
    const l = this.liquidacion();
    if (!l) return null;
    const texto = textoComprobante(this.centro(), this.mesElegido(), l);
    return `https://wa.me/?text=${encodeURIComponent(texto)}`;
  });

  constructor() {
    effect(() => {
      void this.cargar(this.profesionalId(), this.mesElegido());
    });
  }

  protected dia(fecha: string): string {
    const [, m, d] = fecha.split('-');
    return `${NOMBRE_DIA[diaSemana(fecha) - 1]} ${d}/${m}`;
  }

  protected fecha(iso: string): string {
    return new Date(iso).toLocaleDateString('es-AR');
  }

  protected irA(n: number): void {
    void this.router.navigate([], {
      queryParams: { mes: sumarMes(this.mesElegido(), n) },
      queryParamsHandling: 'merge',
    });
  }

  protected imprimir(): void {
    window.print();
  }

  private async cargar(profesionalId: string, mes: string): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [lista, sesiones] = await Promise.all([
        this.liquidaciones.listar(mes),
        this.cobros.prestaciones({ mes, profesionalId }),
      ]);
      this.liquidacion.set(lista.find((l) => l.profesional.id === profesionalId) ?? null);
      this.sesiones.set(
        [...sesiones].sort((a, b) => (a.fecha + a.hora).localeCompare(b.fecha + b.hora)),
      );
    } catch (e) {
      this.liquidacion.set(null);
      this.error.set(mensajeDeError(e, 'No se pudo armar el comprobante.'));
    } finally {
      this.cargando.set(false);
    }
  }
}

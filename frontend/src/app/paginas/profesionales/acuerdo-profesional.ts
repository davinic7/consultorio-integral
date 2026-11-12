import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AcuerdosApi, mensajeDeError } from '../../core/api/api';
import type { AcuerdoAlquiler, DatosAcuerdo, Profesional } from '../../core/api/modelos';
import { nombreMes, plata } from '../../core/cobros';
import { hoyEn } from '../../core/fechas';
import { AuthService } from '../../core/auth/auth.service';

/** Campos numéricos del formulario (texto vacío = no se usa ese componente). */
interface FormAcuerdo {
  desde: string;
  montoFijo: string;
  porcentaje: string;
  montoPorSesion: string;
  montoPorHora: string;
  sesionesEquivalentes: string;
  cobraElCentro: boolean;
  nota: string;
}

const numero = (v: string): number | null => {
  const t = String(v ?? '').trim();
  return t === '' ? null : Number(t);
};
const texto = (n: number | null) => (n === null ? '' : String(n));

/** Resumen en una línea de lo que suma un acuerdo. */
export function resumenAcuerdo(a: AcuerdoAlquiler): string {
  const partes: string[] = [];
  if (a.montoFijo !== null) partes.push(`cuota fija ${plata(a.montoFijo)}`);
  if (a.porcentaje !== null) partes.push(`${a.porcentaje} % de lo facturado`);
  if (a.montoPorSesion !== null) partes.push(`${plata(a.montoPorSesion)} por sesión`);
  if (a.montoPorHora !== null) partes.push(`${plata(a.montoPorHora)} por hora de sala`);
  if (a.sesionesEquivalentes !== null)
    partes.push(
      `${a.sesionesEquivalentes} ${a.sesionesEquivalentes === 1 ? 'sesión' : 'sesiones'} al precio particular`,
    );
  const que = partes.length ? partes.join(' + ') : 'sin cargo';
  return a.cobraElCentro ? que : `${que} · cobra el profesional`;
}

/**
 * Acuerdo de alquiler de un profesional con el centro: el vigente, el historial y
 * el formulario para cargar uno que rija desde un mes. Los componentes se suman.
 */
@Component({
  selector: 'app-acuerdo-profesional',
  imports: [FormsModule],
  styles: `
    .grilla {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(13rem, 1fr));
      gap: 0.75rem 1rem;
    }
    .historial {
      list-style: none;
      padding: 0;
      margin: 0;
      display: grid;
      gap: 0.5rem;
    }
    .historial li {
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .acciones {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      align-items: center;
    }
    h3 {
      margin: 0 0 0.25rem;
    }
  `,
  template: `
    <section class="oc-tarjeta" aria-labelledby="acu-t">
      <h2 id="acu-t">
        Acuerdo de alquiler · {{ profesional().apellido }}, {{ profesional().nombre }}
      </h2>
      <p class="oc-suave">
        Lo que el profesional le paga al centro cada mes es la suma de los componentes que cargues.
        Cada cambio rige desde un mes; los meses ya liquidados no cambian.
      </p>

      @if (cargando()) {
        <p class="oc-suave">Cargando…</p>
      } @else {
        <h3>Historial</h3>
        @if (acuerdos().length === 0) {
          <p class="oc-suave">
            Sin acuerdo: no paga alquiler y el centro le liquida todo lo facturado.
          </p>
        } @else {
          <ul class="historial">
            @for (a of acuerdos(); track a.id) {
              <li>
                <span>
                  <strong>Desde {{ nombreMes(a.vigenteDesde) }}</strong>
                  @if (a.id === vigente()?.id) {
                    <span class="oc-estado oc-estado--ok">Vigente</span>
                  }
                  <div class="oc-suave">{{ resumen(a) }}</div>
                  @if (a.nota) {
                    <div class="oc-suave">{{ a.nota }}</div>
                  }
                </span>
                <span class="acciones">
                  <button type="button" class="enlace" (click)="editar(a)">Editar</button>
                  <button type="button" class="enlace" (click)="borrar(a)" [disabled]="ocupado()">
                    Borrar
                  </button>
                </span>
              </li>
            }
          </ul>
        }

        <form (ngSubmit)="guardar()" class="seccion">
          <h3>
            {{
              editandoMes()
                ? 'Editar el acuerdo desde ' + nombreMes(editandoMes()!)
                : 'Nuevo acuerdo'
            }}
          </h3>
          <div class="grilla">
            <label class="oc-campo">
              <span>Rige desde</span>
              <input type="month" name="desde" [(ngModel)]="form.desde" required />
            </label>
            <label class="oc-campo">
              <span>Cuota fija mensual ($)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                name="fijo"
                [(ngModel)]="form.montoFijo"
                placeholder="No usa"
              />
            </label>
            <label class="oc-campo">
              <span>Porcentaje de lo facturado (%)</span>
              <input
                type="number"
                min="0"
                max="100"
                step="0.01"
                name="pct"
                [(ngModel)]="form.porcentaje"
                placeholder="No usa"
              />
            </label>
            <label class="oc-campo">
              <span>Por sesión atendida ($)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                name="ses"
                [(ngModel)]="form.montoPorSesion"
                placeholder="No usa"
              />
            </label>
            <label class="oc-campo">
              <span>Por hora de sala ($)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                name="hora"
                [(ngModel)]="form.montoPorHora"
                placeholder="No usa"
              />
            </label>
            <label class="oc-campo">
              <span>Equivale a N sesiones</span>
              <input
                type="number"
                min="1"
                step="1"
                name="n"
                [(ngModel)]="form.sesionesEquivalentes"
                placeholder="No usa"
              />
              <small class="oc-suave">Al precio particular vigente de la sesión.</small>
            </label>
            <label class="oc-campo">
              <span>Nota</span>
              <input name="nota" maxlength="200" [(ngModel)]="form.nota" placeholder="Opcional" />
            </label>
          </div>
          <label class="oc-check">
            <input type="checkbox" name="cobra" [(ngModel)]="form.cobraElCentro" />
            El centro cobra a los pacientes por este profesional y le liquida lo suyo
          </label>
          <p class="oc-suave">
            Si no, el profesional cobra y factura por su cuenta, y la liquidación muestra solo lo
            que le debe al centro.
          </p>
          @if (error(); as mensaje) {
            <p class="oc-alerta oc-alerta--error" role="alert">{{ mensaje }}</p>
          }
          <div class="acciones">
            <button type="submit" class="oc-btn oc-btn--primario" [disabled]="ocupado()">
              Guardar acuerdo
            </button>
            @if (editandoMes()) {
              <button type="button" class="oc-btn oc-btn--chico" (click)="nuevo()">
                Cancelar edición
              </button>
            }
            <button type="button" class="oc-btn oc-btn--chico" (click)="cerrado.emit()">
              Cerrar
            </button>
          </div>
        </form>
      }
    </section>
  `,
})
export class AcuerdoProfesional implements OnInit {
  readonly profesional = input.required<Profesional>();
  readonly cerrado = output<void>();

  private readonly api = inject(AcuerdosApi);
  private readonly auth = inject(AuthService);

  protected readonly acuerdos = signal<AcuerdoAlquiler[]>([]);
  protected readonly cargando = signal(true);
  protected readonly ocupado = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editandoMes = signal<string | null>(null);
  protected readonly nombreMes = nombreMes;
  protected readonly resumen = resumenAcuerdo;

  private readonly mesActual = computed(() =>
    hoyEn(this.auth.sesion()?.centro?.zonaHoraria).slice(0, 7),
  );
  /** El que rige este mes (el más nuevo que ya empezó). */
  protected readonly vigente = computed(
    () => this.acuerdos().find((a) => a.vigenteDesde <= this.mesActual()) ?? null,
  );
  protected form: FormAcuerdo = this.vacio();

  ngOnInit(): void {
    void this.cargar();
  }

  protected nuevo(): void {
    this.editandoMes.set(null);
    this.form = this.vacio();
    this.error.set(null);
  }

  protected editar(a: AcuerdoAlquiler): void {
    this.editandoMes.set(a.vigenteDesde);
    this.form = {
      desde: a.vigenteDesde,
      montoFijo: texto(a.montoFijo),
      porcentaje: texto(a.porcentaje),
      montoPorSesion: texto(a.montoPorSesion),
      montoPorHora: texto(a.montoPorHora),
      sesionesEquivalentes: texto(a.sesionesEquivalentes),
      cobraElCentro: a.cobraElCentro,
      nota: a.nota ?? '',
    };
    this.error.set(null);
  }

  protected async guardar(): Promise<void> {
    if (!/^\d{4}-\d{2}$/.test(this.form.desde)) {
      this.error.set('Elegí el mes desde el que rige.');
      return;
    }
    const datos: DatosAcuerdo = {
      montoFijo: numero(this.form.montoFijo),
      porcentaje: numero(this.form.porcentaje),
      montoPorSesion: numero(this.form.montoPorSesion),
      montoPorHora: numero(this.form.montoPorHora),
      sesionesEquivalentes: numero(this.form.sesionesEquivalentes),
      cobraElCentro: this.form.cobraElCentro,
      nota: this.form.nota.trim() || null,
    };
    await this.hacer(async () => {
      const anterior = this.editandoMes();
      await this.api.guardar(this.profesional().id, this.form.desde, datos);
      // Editar cambiando el mes: el acuerdo pasa al mes nuevo.
      if (anterior && anterior !== this.form.desde)
        await this.api.borrar(this.profesional().id, anterior);
      this.nuevo();
    });
  }

  protected async borrar(a: AcuerdoAlquiler): Promise<void> {
    if (!confirm(`¿Borrar el acuerdo desde ${nombreMes(a.vigenteDesde)}?`)) return;
    await this.hacer(() => this.api.borrar(this.profesional().id, a.vigenteDesde));
  }

  private async hacer(accion: () => Promise<unknown>): Promise<void> {
    this.ocupado.set(true);
    this.error.set(null);
    try {
      await accion();
      await this.cargar();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.ocupado.set(false);
    }
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.acuerdos.set(await this.api.listar(this.profesional().id));
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo cargar el acuerdo.'));
    } finally {
      this.cargando.set(false);
    }
  }

  private vacio(): FormAcuerdo {
    return {
      desde: this.mesActual(),
      montoFijo: '',
      porcentaje: '',
      montoPorSesion: '',
      montoPorHora: '',
      sesionesEquivalentes: '',
      cobraElCentro: true,
      nota: '',
    };
  }
}

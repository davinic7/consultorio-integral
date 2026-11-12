import { Component, inject, OnInit, signal } from '@angular/core';
import {
  FormsModule,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { mensajeDeError, PlataformaApi } from '../../core/api/api';
import type { CentroPlataforma, Plan } from '../../core/api/modelos';
import type { Modulo } from '../../core/auth/auth.models';
import { MODULOS, NOMBRE_MODULO } from '../../core/auth/modulos';
import { plata } from '../../core/cobros';

/** Copia editable de un plan (módulos como conjunto). */
interface PlanEditable {
  plan: Plan;
  nombre: string;
  precioMensual: number;
  modulos: Set<Modulo>;
  /** Texto vacío = sin límite. */
  maxProfesionales: string;
  maxSalas: string;
  maxUsuarios: string;
}

/** Campos de límite del plan, en el orden en que se muestran. */
const LIMITES = [
  { campo: 'maxProfesionales', texto: 'Máx. profesionales' },
  { campo: 'maxSalas', texto: 'Máx. salas' },
  { campo: 'maxUsuarios', texto: 'Máx. personas con acceso' },
] as const;

/** '' → null (sin límite); si no, el número entero. */
function limite(v: string): number | null {
  const t = String(v ?? '').trim();
  return t === '' ? null : Math.max(0, Math.trunc(Number(t)));
}

function textoLimite(n: number | null): string {
  return n === null ? 'sin límite' : String(n);
}

/**
 * Centros y planes de la plataforma (solo superadmin): alta de centros con su
 * primer administrador, cambio de plan y baja; precio y módulos de cada plan.
 */
@Component({
  selector: 'app-plataforma',
  imports: [ReactiveFormsModule, FormsModule],
  styles: `
    .grilla {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      align-items: end;
      gap: 0.75rem;
    }
    .seccion {
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
    }
    .planes {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
      gap: 0.875rem;
    }
    .plan {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .modulos {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 0.25rem 0.75rem;
    }
    h3 {
      margin: 0;
      font: var(--oc-t-subtitulo);
    }
    select {
      min-height: 2.25rem;
    }
  `,
  template: `
    <main class="oc-contenido">
      <div>
        <div class="oc-etiqueta">Superadministración</div>
        <h1>Centros y planes</h1>
      </div>

      @if (error(); as e) {
        <p class="oc-alerta oc-alerta--error" role="alert">{{ e }}</p>
      }
      @if (mensaje(); as m) {
        <p class="oc-alerta oc-alerta--ok" role="status">{{ m }}</p>
      }

      <section class="seccion" aria-labelledby="cen-t">
        <h2 id="cen-t">Centros</h2>
        <div class="oc-tabla-caja">
          <table class="oc-tabla">
            <thead>
              <tr>
                <th>Centro</th>
                <th>Identificador</th>
                <th>Plan</th>
                <th>Personas</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              @for (c of centros(); track c.id) {
                <tr>
                  <td>{{ c.nombre }}</td>
                  <td class="oc-mono">{{ c.slug }}</td>
                  <td>
                    <select
                      [attr.aria-label]="'Plan de ' + c.nombre"
                      [ngModel]="c.plan.codigo"
                      (ngModelChange)="cambiarPlan(c, $event)"
                    >
                      @for (p of planes(); track p.id) {
                        @if (p.activo || p.codigo === c.plan.codigo) {
                          <option [value]="p.codigo">{{ p.nombre }}</option>
                        }
                      }
                    </select>
                  </td>
                  <td class="oc-mono">{{ c._count.miembros }}</td>
                  <td>
                    <button type="button" class="enlace" (click)="alternarCentro(c)">
                      {{ c.activo ? 'Activo · dar de baja' : 'De baja · reactivar' }}
                    </button>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="5" class="oc-suave">Todavía no hay centros.</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <form
          class="oc-tarjeta seccion"
          [formGroup]="formCentro"
          (ngSubmit)="crearCentro()"
          novalidate
        >
          <h3>Nuevo centro</h3>
          <div class="grilla">
            <label class="oc-campo">
              Nombre
              <input formControlName="nombre" />
            </label>
            <label class="oc-campo">
              Identificador (para la URL)
              <input formControlName="slug" placeholder="centro-norte" />
            </label>
            <label class="oc-campo">
              Plan
              <select formControlName="plan">
                @for (p of planes(); track p.id) {
                  @if (p.activo) {
                    <option [value]="p.codigo">{{ p.nombre }}</option>
                  }
                }
              </select>
            </label>
          </div>
          <div class="grilla">
            <label class="oc-campo">
              Email del administrador
              <input type="email" formControlName="email" />
            </label>
            <label class="oc-campo">
              Nombre del administrador
              <input formControlName="adminNombre" />
            </label>
            <label class="oc-campo">
              Contraseña (si no tiene cuenta)
              <input type="password" formControlName="password" autocomplete="new-password" />
            </label>
          </div>
          <label class="oc-check">
            <input type="checkbox" formControlName="atiende" />
            El administrador también atiende (profesional que trabaja solo, sin recepción)
          </label>
          @if (formCentro.controls.atiende.value) {
            <div class="grilla">
              <label class="oc-campo">
                Nombre del profesional
                <input formControlName="profNombre" />
              </label>
              <label class="oc-campo">
                Apellido
                <input formControlName="apellido" />
              </label>
              <label class="oc-campo">
                Disciplina
                <input formControlName="disciplina" placeholder="Psicología" />
              </label>
              <label class="oc-campo">
                Matrícula (opcional)
                <input formControlName="matricula" />
              </label>
            </div>
          }
          <div>
            <button type="submit" class="oc-btn oc-btn--primario" [disabled]="ocupado()">
              Crear centro
            </button>
          </div>
        </form>
      </section>

      <section class="seccion" aria-labelledby="pla-t">
        <h2 id="pla-t">Planes</h2>
        <div class="planes">
          @for (e of editables(); track e.plan.id) {
            <article class="oc-tarjeta plan">
              <div>
                <h3>{{ e.plan.nombre }}</h3>
                <div class="oc-suave">
                  {{ e.plan.codigo }} · {{ e.plan.centros }}
                  {{ e.plan.centros === 1 ? 'centro' : 'centros' }} ·
                  {{ plata(e.plan.precioMensual) }} por mes{{ e.plan.activo ? '' : ' · inactivo' }}
                </div>
                <div class="oc-suave">
                  Profesionales: {{ textoLimite(e.plan.maxProfesionales) }} · Salas:
                  {{ textoLimite(e.plan.maxSalas) }} · Personas:
                  {{ textoLimite(e.plan.maxUsuarios) }}
                </div>
              </div>
              <div class="grilla">
                <label class="oc-campo">
                  Nombre
                  <input [(ngModel)]="e.nombre" [name]="'n' + e.plan.id" />
                </label>
                <label class="oc-campo">
                  Precio mensual ($)
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    [(ngModel)]="e.precioMensual"
                    [name]="'p' + e.plan.id"
                  />
                </label>
                @for (l of limites; track l.campo) {
                  <label class="oc-campo">
                    {{ l.texto }}
                    <input
                      type="number"
                      min="0"
                      step="1"
                      placeholder="Sin límite"
                      [(ngModel)]="e[l.campo]"
                      [name]="l.campo + e.plan.id"
                    />
                  </label>
                }
              </div>
              <fieldset class="modulos">
                <legend class="oc-suave">Módulos</legend>
                @for (m of modulos; track m) {
                  <label class="oc-check">
                    <input
                      type="checkbox"
                      [checked]="e.modulos.has(m)"
                      (change)="alternarModulo(e, m)"
                    />
                    {{ nombreModulo[m] }}
                  </label>
                }
              </fieldset>
              <div class="acciones">
                <button
                  type="button"
                  class="oc-btn oc-btn--primario oc-btn--chico"
                  (click)="guardarPlan(e)"
                  [disabled]="ocupado()"
                >
                  Guardar
                </button>
                <button type="button" class="enlace" (click)="alternarPlan(e.plan)">
                  {{ e.plan.activo ? 'Desactivar' : 'Activar' }}
                </button>
              </div>
            </article>
          }
        </div>

        <form class="oc-tarjeta seccion" [formGroup]="formPlan" (ngSubmit)="crearPlan()" novalidate>
          <h3>Nuevo plan</h3>
          <div class="grilla">
            <label class="oc-campo">
              Código
              <input formControlName="codigo" placeholder="consultorio" />
            </label>
            <label class="oc-campo">
              Nombre
              <input formControlName="nombre" />
            </label>
            <label class="oc-campo">
              Precio mensual ($)
              <input type="number" min="0" step="0.01" formControlName="precioMensual" />
            </label>
          </div>
          <p class="oc-suave">
            Se crea con Agenda, Asistencia y Pacientes; después se ajustan los módulos.
          </p>
          <div>
            <button type="submit" class="oc-btn oc-btn--primario" [disabled]="ocupado()">
              Crear plan
            </button>
          </div>
        </form>
      </section>
    </main>
  `,
})
export class Plataforma implements OnInit {
  private readonly api = inject(PlataformaApi);
  private readonly fb = inject(NonNullableFormBuilder);

  protected readonly centros = signal<CentroPlataforma[]>([]);
  protected readonly planes = signal<Plan[]>([]);
  protected readonly editables = signal<PlanEditable[]>([]);
  protected readonly ocupado = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly mensaje = signal<string | null>(null);
  protected readonly modulos = MODULOS;
  protected readonly nombreModulo = NOMBRE_MODULO;
  protected readonly plata = plata;
  protected readonly limites = LIMITES;
  protected readonly textoLimite = textoLimite;

  protected readonly formCentro = this.fb.group({
    nombre: ['', [Validators.required, Validators.maxLength(120)]],
    slug: ['', [Validators.required, Validators.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)]],
    plan: ['centro-basico', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    adminNombre: ['', Validators.required],
    password: [''],
    atiende: [false],
    profNombre: [''],
    apellido: [''],
    disciplina: [''],
    matricula: [''],
  });

  protected readonly formPlan = this.fb.group({
    codigo: ['', [Validators.required, Validators.pattern(/^[a-z0-9-]{2,30}$/)]],
    nombre: ['', Validators.required],
    precioMensual: [0, [Validators.required, Validators.min(0)]],
  });

  ngOnInit(): void {
    void this.cargar();
  }

  protected alternarModulo(e: PlanEditable, m: Modulo): void {
    if (e.modulos.has(m)) e.modulos.delete(m);
    else e.modulos.add(m);
  }

  protected guardarPlan(e: PlanEditable) {
    return this.hacer(
      () =>
        this.api.actualizarPlan(e.plan.id, {
          nombre: e.nombre.trim(),
          precioMensual: Number(e.precioMensual),
          modulos: MODULOS.filter((m) => e.modulos.has(m)),
          maxProfesionales: limite(e.maxProfesionales),
          maxSalas: limite(e.maxSalas),
          maxUsuarios: limite(e.maxUsuarios),
        }),
      `Plan ${e.nombre} guardado. Los centros lo ven al renovar su sesión.`,
    );
  }

  protected alternarPlan(p: Plan) {
    return this.hacer(() => this.api.actualizarPlan(p.id, { activo: !p.activo }));
  }

  protected cambiarPlan(c: CentroPlataforma, plan: string) {
    return this.hacer(
      () => this.api.actualizarCentro(c.id, { plan }),
      `${c.nombre} pasó al plan ${this.planes().find((p) => p.codigo === plan)?.nombre ?? plan}.`,
    );
  }

  protected alternarCentro(c: CentroPlataforma) {
    return this.hacer(() => this.api.actualizarCentro(c.id, { activo: !c.activo }));
  }

  protected async crearCentro(): Promise<void> {
    if (this.formCentro.invalid) {
      this.formCentro.markAllAsTouched();
      this.error.set('Revisá los datos del centro (el identificador va en minúsculas y guiones).');
      return;
    }
    const v = this.formCentro.getRawValue();
    if (v.atiende && (!v.profNombre.trim() || !v.apellido.trim() || !v.disciplina.trim())) {
      this.error.set('Si el administrador atiende, completá su nombre, apellido y disciplina.');
      return;
    }
    await this.hacer(
      () =>
        this.api.crearCentro({
          nombre: v.nombre.trim(),
          slug: v.slug.trim(),
          plan: v.plan,
          admin: {
            email: v.email.trim(),
            nombre: v.adminNombre.trim(),
            ...(v.password ? { password: v.password } : {}),
          },
          ...(v.atiende
            ? {
                atiende: {
                  nombre: v.profNombre.trim(),
                  apellido: v.apellido.trim(),
                  disciplina: v.disciplina.trim(),
                  ...(v.matricula.trim() ? { matricula: v.matricula.trim() } : {}),
                },
              }
            : {}),
        }),
      `Centro ${v.nombre} creado.`,
    );
    if (!this.error()) this.formCentro.reset({ plan: v.plan });
  }

  protected async crearPlan(): Promise<void> {
    if (this.formPlan.invalid) {
      this.formPlan.markAllAsTouched();
      this.error.set('El código va en minúsculas, números y guiones.');
      return;
    }
    const v = this.formPlan.getRawValue();
    await this.hacer(
      () =>
        this.api.crearPlan({
          codigo: v.codigo.trim(),
          nombre: v.nombre.trim(),
          precioMensual: Number(v.precioMensual),
          modulos: ['agenda', 'asistencia', 'pacientes'],
        }),
      `Plan ${v.nombre} creado.`,
    );
    if (!this.error()) this.formPlan.reset();
  }

  private async hacer(op: () => Promise<unknown>, ok?: string): Promise<void> {
    this.ocupado.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      await op();
      if (ok) this.mensaje.set(ok);
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.ocupado.set(false);
      await this.cargar();
    }
  }

  private async cargar(): Promise<void> {
    try {
      const [centros, planes] = await Promise.all([this.api.centros(), this.api.planes()]);
      this.centros.set(centros);
      this.planes.set(planes);
      this.editables.set(
        planes.map((plan) => ({
          plan,
          nombre: plan.nombre,
          precioMensual: plan.precioMensual,
          modulos: new Set(plan.modulos),
          maxProfesionales: plan.maxProfesionales?.toString() ?? '',
          maxSalas: plan.maxSalas?.toString() ?? '',
          maxUsuarios: plan.maxUsuarios?.toString() ?? '',
        })),
      );
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar los centros y planes.'));
    }
  }
}

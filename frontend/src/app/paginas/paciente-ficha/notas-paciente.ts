import { Component, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensajeDeError, NotasApi } from '../../core/api/api';
import type { Nota } from '../../core/api/modelos';

const FORMATO_FECHA = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * Notas de sesión del profesional. Privadas por defecto; las compartidas las ven
 * los demás profesionales que atienden al paciente. Se guardan cifradas.
 */
@Component({
  selector: 'app-notas-paciente',
  imports: [FormsModule],
  styles: `
    .notas {
      display: flex;
      flex-direction: column;
      gap: 0.875rem;
    }
    .notas h2 {
      margin: 0;
      font: var(--oc-t-subtitulo);
    }
    .notas p {
      margin: 0;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .notas__acciones {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
    }
    .notas__lista {
      display: flex;
      flex-direction: column;
      gap: 0.625rem;
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .nota {
      display: block;
      padding: 0.875rem 1rem;
      border: 1px solid var(--oc-borde);
      border-radius: var(--oc-radio);
      background: var(--oc-carril);
    }
    .nota strong {
      font-family: var(--oc-fuente-mono);
      font-weight: 500;
      font-size: 0.8125rem;
    }
    .oc-estado {
      margin-left: 0.5rem;
    }
    .nota__texto {
      margin: 0.5rem 0 0;
      white-space: pre-wrap;
    }
    .nota__pie {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      align-items: center;
      justify-content: space-between;
    }
    textarea {
      width: 100%;
      min-height: 7rem;
      font: inherit;
      box-sizing: border-box;
    }
  `,
  template: `
    <section class="oc-tarjeta notas" aria-labelledby="titulo-notas">
      <h2 id="titulo-notas">Notas de sesión</h2>
      <p class="oc-suave">
        Solo vos ves tus notas. Si marcás "Compartir con el equipo", también las ven los demás
        profesionales que atienden al paciente. Administración y recepción no las ven. Se guardan
        cifradas.
      </p>

      <form (ngSubmit)="guardar()">
        <label class="oc-campo">
          {{ editando() ? 'Editar nota' : 'Nueva nota' }}
          <textarea [(ngModel)]="texto" name="texto" maxlength="20000" required></textarea>
        </label>
        <label class="oc-check">
          <input type="checkbox" [(ngModel)]="compartida" name="compartida" />
          Compartir con el equipo
        </label>
        @if (error(); as mensaje) {
          <p class="oc-alerta oc-alerta--error" role="alert">{{ mensaje }}</p>
        }
        <div class="notas__acciones">
          <button type="submit" class="oc-btn oc-btn--primario" [disabled]="guardando() || !texto.trim()">
            {{ guardando() ? 'Guardando…' : editando() ? 'Guardar cambios' : 'Agregar nota' }}
          </button>
          @if (editando()) {
            <button type="button" class="enlace" (click)="limpiar()">Cancelar edición</button>
          }
        </div>
      </form>

      @if (cargando()) {
        <p class="oc-suave">Cargando…</p>
      } @else if (notas().length) {
        <ul class="notas__lista">
          @for (n of notas(); track n.id) {
            <li class="nota">
              <div class="nota__pie">
                <span>
                  <strong>{{ fecha(n.creadaEn) }}</strong>
                  <span class="oc-suave">
                    · {{ n.propia ? 'Vos' : n.profesional.apellido + ', ' + n.profesional.nombre }}
                    ({{ n.profesional.disciplina }})
                  </span>
                  @if (n.compartida) {
                    <span class="oc-estado oc-estado--info">Compartida</span>
                  } @else {
                    <span class="oc-estado">Privada</span>
                  }
                </span>
                @if (n.propia) {
                  <button type="button" class="enlace" (click)="editar(n)">Editar</button>
                }
              </div>
              <p class="nota__texto">{{ n.texto }}</p>
            </li>
          }
        </ul>
      } @else {
        <p class="oc-suave">Todavía no hay notas.</p>
      }
    </section>
  `,
})
export class NotasPaciente implements OnInit {
  readonly pacienteId = input.required<string>();

  private readonly api = inject(NotasApi);

  protected readonly notas = signal<Nota[]>([]);
  protected readonly cargando = signal(true);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly editando = signal<Nota | null>(null);
  protected texto = '';
  protected compartida = false;

  async ngOnInit(): Promise<void> {
    await this.cargar();
  }

  protected fecha(iso: string): string {
    return FORMATO_FECHA.format(new Date(iso));
  }

  protected editar(n: Nota): void {
    this.editando.set(n);
    this.texto = n.texto;
    this.compartida = n.compartida;
    this.error.set(null);
  }

  protected limpiar(): void {
    this.editando.set(null);
    this.texto = '';
    this.compartida = false;
  }

  protected async guardar(): Promise<void> {
    if (!this.texto.trim()) return;
    this.guardando.set(true);
    this.error.set(null);
    try {
      const nota = this.editando();
      if (nota) {
        await this.api.editar(nota.id, { texto: this.texto, compartida: this.compartida });
      } else {
        await this.api.crear(this.pacienteId(), {
          texto: this.texto,
          compartida: this.compartida,
        });
      }
      this.limpiar();
      await this.cargar();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  private async cargar(): Promise<void> {
    try {
      this.notas.set(await this.api.listar(this.pacienteId()));
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar las notas.'));
    } finally {
      this.cargando.set(false);
    }
  }
}

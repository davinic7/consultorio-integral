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
    .nota {
      display: block;
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
    <section class="panel" aria-labelledby="titulo-notas">
      <h2 id="titulo-notas">Notas de sesión</h2>
      <p class="sutil">
        Solo vos ves tus notas. Si marcás "Compartir con el equipo", también las ven los demás
        profesionales que atienden al paciente. Administración y recepción no las ven. Se guardan
        cifradas.
      </p>

      <form (ngSubmit)="guardar()">
        <label class="campo">
          <span>{{ editando() ? 'Editar nota' : 'Nueva nota' }}</span>
          <textarea [(ngModel)]="texto" name="texto" maxlength="20000" required></textarea>
        </label>
        <label class="check">
          <input type="checkbox" [(ngModel)]="compartida" name="compartida" />
          Compartir con el equipo
        </label>
        @if (error(); as mensaje) {
          <p class="aviso aviso--error" role="alert">{{ mensaje }}</p>
        }
        <div class="acciones">
          <button type="submit" class="boton" [disabled]="guardando() || !texto.trim()">
            {{ guardando() ? 'Guardando…' : editando() ? 'Guardar cambios' : 'Agregar nota' }}
          </button>
          @if (editando()) {
            <button type="button" class="enlace" (click)="limpiar()">Cancelar edición</button>
          }
        </div>
      </form>

      @if (cargando()) {
        <p class="sutil">Cargando…</p>
      } @else if (notas().length) {
        <ul class="lista">
          @for (n of notas(); track n.id) {
            <li class="lista__item nota">
              <div class="nota__pie">
                <span>
                  <strong>{{ fecha(n.creadaEn) }}</strong>
                  <span class="sutil">
                    · {{ n.propia ? 'Vos' : n.profesional.apellido + ', ' + n.profesional.nombre }}
                    ({{ n.profesional.disciplina }})
                  </span>
                  @if (n.compartida) {
                    <span class="etiqueta etiqueta--info">Compartida</span>
                  } @else {
                    <span class="etiqueta">Privada</span>
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
        <p class="sutil">Todavía no hay notas.</p>
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

import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensajeDeError, NotasApi } from '../../core/api/api';
import type { Nota } from '../../core/api/modelos';
import { colorDisciplina, iniciales } from '../../core/disciplina';
import {
  estaVacio,
  etiquetaMomento,
  fechaYHora,
  momentoDe,
  resumen,
  secciones,
  textoParaGuardar,
} from '../../core/expediente';

/**
 * Una evolución de la línea de tiempo: resumen, lectura completa y, si es propia,
 * edición y quién la ve. Las de otros profesionales se marcan "solo lectura".
 */
@Component({
  selector: 'li[appEvolucion]',
  imports: [FormsModule],
  templateUrl: './evolucion-expediente.html',
  styleUrl: './evolucion-expediente.scss',
  host: {
    class: 'evo',
    '[class.evo--ajena]': '!nota().propia',
    '[class.evo--editando]': 'editando()',
  },
})
export class EvolucionExpediente {
  readonly nota = input.required<Nota>();
  readonly zona = input.required<string>();
  readonly hoy = input.required<string>();
  readonly abierta = input(false);

  readonly alternar = output<void>();
  /** La evolución cambió (texto o quién la ve). */
  readonly cambio = output<Nota>();
  readonly aviso = output<string>();
  readonly error = output<string>();

  private readonly api = inject(NotasApi);

  protected readonly editando = signal(false);
  protected readonly textoEdicion = signal('');
  protected readonly guardando = signal(false);

  protected readonly v = computed(() => {
    const n = this.nota();
    const zona = this.zona();
    const hoy = this.hoy();
    const p = n.profesional;
    return {
      fecha: etiquetaMomento(momentoDe(n), zona, hoy),
      turno: n.turno ? `Turno${n.turno.sala ? ` · ${n.turno.sala}` : ''}` : 'Sin turno',
      autor: n.propia ? 'Vos' : `${p.nombre} ${p.apellido} · ${p.disciplina}`,
      iniciales: iniciales(p.nombre, p.apellido),
      color: colorDisciplina(p.disciplina),
      resumen: resumen(n.texto),
      secciones: secciones(n.texto),
      pie: n.editadaEn
        ? `Editada el ${fechaYHora(n.editadaEn, zona, hoy)}`
        : `Creada el ${fechaYHora(n.creadaEn, zona, hoy)}`,
      quienVe: n.compartida ? 'La ve también el equipo del paciente' : 'La ves solo vos',
    };
  });

  protected editar(): void {
    if (!this.abierta()) this.alternar.emit();
    this.textoEdicion.set(this.nota().texto);
    this.editando.set(true);
    setTimeout(() => document.getElementById(`edicion-${this.nota().id}`)?.focus(), 0);
  }

  protected cancelar(): void {
    this.editando.set(false);
  }

  protected async guardar(): Promise<void> {
    if (estaVacio(this.textoEdicion())) {
      this.error.emit('La evolución no puede quedar vacía.');
      return;
    }
    this.guardando.set(true);
    try {
      const nueva = await this.api.editar(this.nota().id, {
        texto: textoParaGuardar(this.textoEdicion()),
      });
      this.editando.set(false);
      this.cambio.emit(nueva);
      this.aviso.emit('Cambios guardados. Queda registrada la fecha de la edición.');
    } catch (e) {
      this.error.emit(mensajeDeError(e, 'No se pudieron guardar los cambios.'));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async cambiarVisibilidad(compartida: boolean): Promise<void> {
    if (this.nota().compartida === compartida) return;
    try {
      this.cambio.emit(await this.api.editar(this.nota().id, { compartida }));
      this.aviso.emit(
        compartida
          ? 'Ahora la ve también el equipo del paciente.'
          : 'Ahora es privada: la ves solo vos.',
      );
    } catch (e) {
      this.error.emit(mensajeDeError(e, 'No se pudo cambiar quién la ve.'));
    }
  }
}

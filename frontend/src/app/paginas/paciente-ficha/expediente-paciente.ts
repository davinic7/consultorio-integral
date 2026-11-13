import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { mensajeDeError, NotasApi } from '../../core/api/api';
import type { BorradorNota, Nota, SesionesNota } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { DictadoService } from '../../core/dictado/dictado.service';
import {
  AUTORES,
  agruparPorMes,
  fechaYHora,
  filtrar,
  type FiltroAutor,
  ordenar,
  type Periodo,
  PERIODOS,
  resumen,
} from '../../core/expediente';
import { hoyEn } from '../../core/fechas';
import { EvolucionExpediente } from './evolucion-expediente';
import { type ModoPanel, PanelEvolucion } from './panel-evolucion';

const ZONA_POR_DEFECTO = 'America/Argentina/Catamarca';

/**
 * Pestaña Expediente de la ficha: la línea de tiempo de evoluciones del paciente
 * para quien escribe notas, con búsqueda y filtros, y el panel de nueva evolución.
 * Diseño en docs/diseno/expediente-dictado.md.
 */
@Component({
  selector: 'app-expediente-paciente',
  imports: [FormsModule, EvolucionExpediente, PanelEvolucion],
  templateUrl: './expediente-paciente.html',
  styleUrl: './expediente-paciente.scss',
})
export class ExpedientePaciente implements OnInit {
  readonly pacienteId = input.required<string>();
  /** Nombre del paciente, para los textos ("Todavía no hay evoluciones de Lucía"). */
  readonly nombre = input('');

  private readonly api = inject(NotasApi);
  private readonly auth = inject(AuthService);
  private readonly dictado = inject(DictadoService);

  /** Dictar y Escribir con el mismo peso, si el plan y el servidor permiten dictar. */
  protected readonly puedeDictar = computed(
    () => this.dictado.puedeDictar() && this.dictado.disponible() !== false,
  );

  protected readonly periodos = PERIODOS;
  protected readonly autores = AUTORES;

  protected readonly notas = signal<Nota[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly sesiones = signal<SesionesNota | null>(null);
  protected readonly borrador = signal<BorradorNota | null>(null);
  protected readonly modo = signal<ModoPanel>('inicio');
  protected readonly abierta = signal<string | null>(null);

  protected readonly q = signal('');
  protected readonly periodo = signal<Periodo>('todo');
  protected readonly autor = signal<FiltroAutor>('todas');

  protected readonly zona = computed(
    () => this.auth.sesion()?.centro?.zonaHoraria ?? ZONA_POR_DEFECTO,
  );
  protected readonly hoy = computed(() => this.sesiones()?.hoy ?? hoyEn(this.zona()));

  protected readonly filtradas = computed(() =>
    ordenar(
      filtrar(
        this.notas(),
        { q: this.q(), periodo: this.periodo(), autor: this.autor() },
        this.hoy(),
        this.zona(),
      ),
    ),
  );

  protected readonly grupos = computed(() => agruparPorMes(this.filtradas(), this.zona()));

  protected readonly conteo = computed(() => {
    const lista = this.filtradas();
    const mias = lista.filter((n) => n.propia).length;
    const total = `${lista.length} ${lista.length === 1 ? 'evolución' : 'evoluciones'}`;
    return `${total} · ${mias} ${mias === 1 ? 'tuya' : 'tuyas'} · ${lista.length - mias} del equipo`;
  });

  protected readonly resumenBorrador = computed(() => {
    const b = this.borrador();
    return b ? resumen(b.texto) || 'Sin texto todavía' : '';
  });

  protected readonly guardadoBorrador = computed(() => {
    const b = this.borrador();
    return b ? `Guardado el ${fechaYHora(b.actualizadoEn, this.zona(), this.hoy())}` : '';
  });

  async ngOnInit(): Promise<void> {
    const id = this.pacienteId();
    const [notas, sesiones, borrador] = await Promise.allSettled([
      this.api.listar(id),
      this.api.sesiones(id),
      this.api.borrador(id),
    ]);
    if (notas.status === 'fulfilled') this.notas.set(notas.value);
    else this.error.set(mensajeDeError(notas.reason, 'No se pudieron cargar las evoluciones.'));
    if (sesiones.status === 'fulfilled') this.sesiones.set(sesiones.value);
    if (borrador.status === 'fulfilled') this.borrador.set(borrador.value.borrador);
    this.cargando.set(false);
  }

  protected limpiarFiltros(): void {
    this.q.set('');
    this.periodo.set('todo');
    this.autor.set('todas');
  }

  protected alternar(id: string): void {
    this.abierta.update((a) => (a === id ? null : id));
  }

  protected reemplazar(nueva: Nota): void {
    this.notas.update((ns) => ns.map((n) => (n.id === nueva.id ? nueva : n)));
  }

  protected mostrarAviso(mensaje: string): void {
    this.error.set(null);
    this.aviso.set(mensaje);
  }

  protected mostrarError(mensaje: string): void {
    this.aviso.set(null);
    this.error.set(mensaje);
  }

  protected alGuardar(nota: Nota): void {
    this.notas.update((ns) => [nota, ...ns]);
    this.sesiones.update(
      (s) =>
        s && {
          ...s,
          turnos: s.turnos.map((t) => (t.id === nota.turno?.id ? { ...t, conNota: true } : t)),
        },
    );
    this.abierta.set(nota.id);
    this.mostrarAviso(
      nota.compartida
        ? 'Evolución guardada y cifrada. La ve también el equipo del paciente.'
        : 'Evolución guardada y cifrada. La ves solo vos.',
    );
  }
}

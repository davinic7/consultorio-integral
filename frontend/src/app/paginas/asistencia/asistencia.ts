import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { mensajeDeError, ProfesionalesApi, TurnosApi } from '../../core/api/api';
import type { EstadoMarcable, EstadoTurno, Profesional, Turno } from '../../core/api/modelos';
import { NOMBRE_ESTADO, preguntarAvisoTarde, sePuedeMarcar } from '../../core/asistencia';
import { AuthService } from '../../core/auth/auth.service';
import { colorDisciplina, iniciales } from '../../core/disciplina';
import { ahoraEn, diaSemana, NOMBRE_DIA, sumarDias } from '../../core/fechas';

type Filtro = 'todos' | 'pendiente' | 'presente' | 'ausentes';

const MESES = [
  'ENERO',
  'FEBRERO',
  'MARZO',
  'ABRIL',
  'MAYO',
  'JUNIO',
  'JULIO',
  'AGOSTO',
  'SEPTIEMBRE',
  'OCTUBRE',
  'NOVIEMBRE',
  'DICIEMBRE',
];

/** Botones de la lista: "Llegó", "Ausente" y "Justificada". */
const BOTONES: { estado: EstadoMarcable; texto: string }[] = [
  { estado: 'presente', texto: 'Llegó' },
  { estado: 'ausente_sin_aviso', texto: 'Ausente' },
  { estado: 'ausente_con_aviso', texto: 'Justificada' },
];

const CLASE: Record<EstadoTurno, string> = {
  pendiente: '',
  presente: 'oc-estado--ok',
  ausente_sin_aviso: 'oc-estado--error',
  ausente_con_aviso: 'oc-estado--info',
  cancelado_profesional: '',
};

/**
 * Registro de asistencia del día (docs/diseno/referencia/Asistencia.dc.html).
 * Un toque marca; tocar de nuevo el botón activo vuelve el turno a "Por llegar".
 * Admin y recepción ven todos los turnos; el profesional, los suyos.
 */
@Component({
  selector: 'app-asistencia',
  imports: [RouterLink],
  templateUrl: './asistencia.html',
  styleUrl: './asistencia.scss',
})
export class Asistencia {
  private readonly api = inject(TurnosApi);
  private readonly profesionalesApi = inject(ProfesionalesApi);
  /** Para saber si la regla de faltazo de cada uno está activa. */
  private readonly profesionales = signal<Profesional[]>([]);
  private readonly auth = inject(AuthService);
  private readonly zona = computed(() => this.auth.sesion()?.centro?.zonaHoraria);

  protected readonly fecha = signal(ahoraEn(this.zona()).fecha);
  protected readonly turnos = signal<Turno[]>([]);
  protected readonly filtro = signal<Filtro>('todos');
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Turno que se está guardando (para desactivar sus botones). */
  protected readonly guardando = signal<string | null>(null);

  protected readonly botones = BOTONES;
  protected readonly nombreEstado = NOMBRE_ESTADO;
  protected readonly clase = CLASE;
  protected readonly sePuedeMarcar = sePuedeMarcar;

  protected readonly esHoy = computed(() => this.fecha() === ahoraEn(this.zona()).fecha);
  protected readonly titulo = computed(() => {
    const f = this.fecha();
    return `${NOMBRE_DIA[diaSemana(f) - 1].toUpperCase()} ${f.slice(8)} · ${MESES[Number(f.slice(5, 7)) - 1]}`;
  });

  protected readonly conteo = computed(() => {
    const c = { todos: 0, pendiente: 0, presente: 0, ausentes: 0, justificadas: 0, sinAviso: 0 };
    for (const t of this.turnos()) {
      c.todos++;
      if (t.estado === 'pendiente') c.pendiente++;
      else if (t.estado === 'presente') c.presente++;
      else {
        c.ausentes++;
        if (t.estado === 'ausente_con_aviso') c.justificadas++;
        else c.sinAviso++;
      }
    }
    return c;
  });
  protected readonly porcentaje = computed(() => {
    const c = this.conteo();
    const marcados = c.presente + c.ausentes;
    return marcados ? Math.round((c.presente * 100) / marcados) : null;
  });
  protected readonly arco = computed(() => ((this.porcentaje() ?? 0) * 113.1) / 100);

  protected readonly pestanas = computed(() => {
    const c = this.conteo();
    return [
      { id: 'todos' as Filtro, texto: 'Todos', n: c.todos },
      { id: 'pendiente' as Filtro, texto: 'Por llegar', n: c.pendiente },
      { id: 'presente' as Filtro, texto: 'Llegaron', n: c.presente },
      { id: 'ausentes' as Filtro, texto: 'Ausentes', n: c.ausentes },
    ];
  });

  protected readonly filas = computed(() => {
    const f = this.filtro();
    return this.turnos()
      .filter((t) =>
        f === 'todos'
          ? true
          : f === 'ausentes'
            ? t.estado === 'ausente_con_aviso' || t.estado === 'ausente_sin_aviso'
            : t.estado === f,
      )
      .map((t) => ({
        turno: t,
        iniciales: iniciales(t.paciente.nombre, t.paciente.apellido),
        color: colorDisciplina(t.profesional.disciplina),
      }));
  });

  constructor() {
    this.profesionalesApi
      .listar()
      .then((p) => this.profesionales.set(p))
      .catch(() => this.profesionales.set([]));
    effect(() => {
      const fecha = this.fecha();
      if (this.auth.sesion()?.centro) untracked(() => void this.cargar(fecha));
    });
  }

  protected moverDia(dias: number): void {
    this.fecha.update((f) => sumarDias(f, dias));
  }

  protected irAHoy(): void {
    this.fecha.set(ahoraEn(this.zona()).fecha);
  }

  /** Un toque marca; tocar el estado activo lo vuelve a "Por llegar". */
  protected async marcar(t: Turno, estado: EstadoMarcable): Promise<void> {
    const nuevo: EstadoMarcable = t.estado === estado ? 'pendiente' : estado;
    this.guardando.set(t.id);
    this.error.set(null);
    try {
      const regla = this.profesionales().find((p) => p.id === t.profesional.id)?.faltazo;
      const actualizado = await this.api.marcarAsistencia(
        t.id,
        nuevo,
        preguntarAvisoTarde(nuevo, regla),
      );
      this.turnos.update((lista) => lista.map((x) => (x.id === t.id ? actualizado : x)));
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.guardando.set(null);
    }
  }

  private async cargar(fecha: string): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      this.turnos.set(await this.api.listar({ desde: fecha, hasta: fecha }));
    } catch (e) {
      this.turnos.set([]);
      this.error.set(mensajeDeError(e, 'No se pudieron cargar los turnos.'));
    } finally {
      this.cargando.set(false);
    }
  }
}

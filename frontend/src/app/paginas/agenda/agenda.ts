import { Component, computed, DestroyRef, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  mensajeDeError,
  PacientesApi,
  ProfesionalesApi,
  SalasApi,
  TurnosApi,
} from '../../core/api/api';
import type {
  EstadoMarcable,
  Ocupacion,
  Paciente,
  Profesional,
  Sala,
  Turno,
} from '../../core/api/modelos';
import { ESTADOS_MARCABLES, NOMBRE_ESTADO, sePuedeMarcar } from '../../core/asistencia';
import { colorDisciplina, type ColorDisciplina } from '../../core/disciplina';
import { AuthService } from '../../core/auth/auth.service';
import { tieneModulo } from '../../core/auth/modulos';
import {
  ahoraEn,
  diaSemana,
  diasDesde,
  minutos,
  etiquetaDia,
  fechaLarga,
  hoyEn,
  lunesDe,
  NOMBRE_DIA,
  rangoLegible,
  sumarDias,
} from '../../core/fechas';
import {
  Bloque,
  HORA_FIN,
  HORA_INICIO,
  horaEnPosicion,
  PX_POR_HORA,
  ubicarBloques,
} from './bloques';

type Vista = 'semana' | 'dia' | 'salas';

/** Elemento dibujable en una columna: un turno con datos o una ocupación anónima. */
interface Item {
  hora: string;
  horaFin: string;
  turno: Turno | null;
}

interface Columna {
  clave: string;
  titulo: string;
  /** Fecha del alta rápida al tocar un hueco. */
  fecha: string;
  salaId: string | null;
  esHoy: boolean;
  bloques: Bloque<Item>[];
}

interface FormTurno {
  pacienteId: string;
  profesionalId: string;
  salaId: string;
  fecha: string;
  hora: string;
  duracionMin: number;
  observaciones: string;
  repetir: boolean;
  repetirHasta: string;
}

@Component({
  selector: 'app-agenda',
  imports: [FormsModule, RouterLink],
  templateUrl: './agenda.html',
  styleUrl: './agenda.scss',
})
export class Agenda implements OnInit {
  private readonly turnosApi = inject(TurnosApi);
  private readonly profesionalesApi = inject(ProfesionalesApi);
  private readonly salasApi = inject(SalasApi);
  private readonly pacientesApi = inject(PacientesApi);
  private readonly auth = inject(AuthService);

  private readonly zona = computed(() => this.auth.sesion()?.centro?.zonaHoraria);
  protected readonly rol = computed(() => this.auth.sesion()?.rol ?? null);
  protected readonly esProfesional = computed(() => this.rol() === 'profesional');
  /** El plan incluye salas (un consultorio individual no las usa). */
  protected readonly conSalas = computed(() => tieneModulo(this.auth.sesion(), 'salas'));

  protected readonly vista = signal<Vista>('semana');
  protected readonly fecha = signal(hoyEn(this.zona()));
  protected readonly filtroProfesional = signal('');
  protected readonly filtroSala = signal('');

  protected readonly turnos = signal<Turno[]>([]);
  protected readonly ocupacion = signal<Ocupacion[]>([]);
  protected readonly profesionales = signal<Profesional[]>([]);
  protected readonly salas = signal<Sala[]>([]);
  protected readonly pacientes = signal<Paciente[]>([]);
  protected readonly cargando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);

  /** Panel lateral: alta, detalle o edición de un turno. */
  protected readonly panel = signal<'nuevo' | 'detalle' | 'editar' | null>(null);
  protected readonly seleccionado = signal<Turno | null>(null);
  protected readonly guardando = signal(false);
  protected readonly errorPanel = signal<string | null>(null);
  protected form: FormTurno = this.formVacio();
  protected motivoCancelacion = '';
  protected busquedaPaciente = '';

  protected readonly horas = Array.from(
    { length: HORA_FIN - HORA_INICIO },
    (_, i) => `${String(HORA_INICIO + i).padStart(2, '0')}:00`,
  );
  protected readonly altoGrilla = (HORA_FIN - HORA_INICIO) * PX_POR_HORA;
  protected readonly nombreDia = NOMBRE_DIA;

  /** Ficha de profesional de la cuenta logueada (si es profesional). */
  protected readonly miProfesional = computed(() => {
    const usuarioId = this.auth.sesion()?.usuario.id;
    return this.profesionales().find((p) => p.usuarioId === usuarioId) ?? null;
  });
  protected readonly puedeCrear = computed(
    () => !this.esProfesional() || this.miProfesional() !== null,
  );

  protected readonly dias = computed(() =>
    this.vista() === 'semana' ? diasDesde(lunesDe(this.fecha()), 7) : [this.fecha()],
  );
  protected readonly titulo = computed(() => {
    const d = this.dias();
    return d.length > 1 ? rangoLegible(d[0], d[d.length - 1]) : fechaLarga(d[0]);
  });

  protected readonly columnas = computed<Columna[]>(() => {
    const hoy = hoyEn(this.zona());
    if (this.vista() === 'salas') {
      const fecha = this.fecha();
      return this.salas().map((sala) => ({
        clave: sala.id,
        titulo: sala.nombre,
        fecha,
        salaId: sala.id,
        esHoy: fecha === hoy,
        bloques: ubicarBloques(this.itemsDeSala(sala.id, fecha)),
      }));
    }
    return this.dias().map((fecha) => ({
      clave: fecha,
      titulo: etiquetaDia(fecha),
      fecha,
      salaId: this.filtroSala() || null,
      esHoy: fecha === hoy,
      bloques: ubicarBloques(
        this.turnos()
          .filter((t) => t.fecha === fecha)
          .map((t) => ({ hora: t.hora, horaFin: t.horaFin, turno: t })),
      ),
    }));
  });

  protected readonly pacientesFiltrados = computed(() => this.pacientes());

  async ngOnInit(): Promise<void> {
    if (typeof window !== 'undefined' && window.innerWidth < 720) this.vista.set('dia');
    try {
      const [profesionales, salas] = await Promise.all([
        this.profesionalesApi.listar(),
        this.salasApi.listar(),
      ]);
      this.profesionales.set(profesionales);
      this.salas.set(salas);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar profesionales y salas.'));
    }
    await this.cargar();
  }

  // ───────── Navegación y filtros ─────────

  protected cambiarVista(v: Vista): void {
    this.vista.set(v);
    void this.cargar();
  }

  protected mover(direccion: -1 | 1): void {
    this.fecha.update((f) => sumarDias(f, direccion * (this.vista() === 'semana' ? 7 : 1)));
    void this.cargar();
  }

  protected irAHoy(): void {
    this.fecha.set(hoyEn(this.zona()));
    void this.cargar();
  }

  protected irAFecha(fecha: string): void {
    if (!fecha) return;
    this.fecha.set(fecha);
    void this.cargar();
  }

  protected filtrar(): void {
    void this.cargar();
  }

  protected async cargar(): Promise<void> {
    const dias = this.dias();
    this.cargando.set(true);
    this.error.set(null);
    try {
      const [turnos, ocupacion] = await Promise.all([
        this.turnosApi.listar({
          desde: dias[0],
          hasta: dias[dias.length - 1],
          profesionalId:
            this.vista() === 'salas' ? undefined : this.filtroProfesional() || undefined,
          salaId: this.vista() === 'salas' ? undefined : this.filtroSala() || undefined,
        }),
        // Un profesional solo recibe sus turnos: para ver las salas libres usa la ocupación anónima.
        this.vista() === 'salas' && this.esProfesional()
          ? this.turnosApi.ocupacion(dias[0], dias[dias.length - 1])
          : Promise.resolve([]),
      ]);
      this.turnos.set(turnos);
      this.ocupacion.set(ocupacion);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo cargar la agenda.'));
    } finally {
      this.cargando.set(false);
    }
  }

  private itemsDeSala(salaId: string, fecha: string): Item[] {
    const propios = this.turnos().filter((t) => t.fecha === fecha && t.sala?.id === salaId);
    if (!this.esProfesional()) {
      return propios.map((t) => ({ hora: t.hora, horaFin: t.horaFin, turno: t }));
    }
    const yo = this.miProfesional()?.id;
    const ajenos = this.ocupacion()
      .filter((o) => o.fecha === fecha && o.salaId === salaId && o.profesionalId !== yo)
      .map((o) => ({ hora: o.hora, horaFin: o.horaFin, turno: null }));
    return [...propios.map((t) => ({ hora: t.hora, horaFin: t.horaFin, turno: t })), ...ajenos];
  }

  // ───────── Panel ─────────

  /** Fecha y minuto actuales del centro (línea "ahora" y turnos en curso). */
  protected readonly ahora = signal(ahoraEn(this.zona()));
  protected readonly lineaAhora = computed(() => {
    const m = this.ahora().minutos;
    if (m < HORA_INICIO * 60 || m > HORA_FIN * 60) return null;
    return ((m - HORA_INICIO * 60) / 60) * PX_POR_HORA;
  });
  private readonly reloj = (() => {
    const id = setInterval(() => this.ahora.set(ahoraEn(this.zona())), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
    return id;
  })();

  protected color(t: Turno): ColorDisciplina {
    return colorDisciplina(t.profesional.disciplina);
  }

  protected enCurso(t: Turno): boolean {
    const a = this.ahora();
    return t.fecha === a.fecha && minutos(t.hora) <= a.minutos && a.minutos < minutos(t.horaFin);
  }

  protected readonly nombreEstado = NOMBRE_ESTADO;
  protected readonly estadosMarcables = ESTADOS_MARCABLES;
  protected readonly sePuedeMarcar = sePuedeMarcar;

  /** Admin y recepción marcan cualquier turno; el profesional, los suyos. */
  protected puedeMarcar(t: Turno): boolean {
    if (t.estado === 'cancelado_profesional') return false;
    return !this.esProfesional() || t.profesional.id === this.miProfesional()?.id;
  }

  /** Marcado en un clic; tocar el estado elegido de nuevo no hace nada. */
  protected async marcar(estado: EstadoMarcable): Promise<void> {
    const t = this.seleccionado();
    if (!t || t.estado === estado) return;
    this.guardando.set(true);
    this.errorPanel.set(null);
    try {
      const actualizado = await this.turnosApi.marcarAsistencia(t.id, estado);
      this.seleccionado.set(actualizado);
      this.turnos.update((lista) => lista.map((x) => (x.id === t.id ? actualizado : x)));
    } catch (e) {
      this.errorPanel.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  protected puedeGestionar(t: Turno): boolean {
    if (t.estado !== 'pendiente') return false;
    return !this.esProfesional() || t.profesional.id === this.miProfesional()?.id;
  }

  protected tocarHueco(col: Columna, evento: MouseEvent): void {
    if (!this.puedeCrear()) return;
    const hora = horaEnPosicion(evento.offsetY);
    this.abrirNuevo(col.fecha, hora, col.salaId);
  }

  protected async abrirNuevo(fecha = this.fecha(), hora = '09:00', salaId: string | null = null) {
    this.form = {
      ...this.formVacio(),
      fecha,
      hora,
      salaId: salaId ?? (this.filtroSala() || ''),
      profesionalId: this.esProfesional()
        ? (this.miProfesional()?.id ?? '')
        : this.filtroProfesional(),
    };
    this.seleccionado.set(null);
    this.errorPanel.set(null);
    this.panel.set('nuevo');
    await this.buscarPacientes();
  }

  protected verTurno(t: Turno | null, evento: Event): void {
    evento.stopPropagation();
    if (!t) return;
    this.seleccionado.set(t);
    this.motivoCancelacion = '';
    this.errorPanel.set(null);
    this.panel.set('detalle');
  }

  protected editar(): void {
    const t = this.seleccionado();
    if (!t) return;
    this.form = {
      ...this.formVacio(),
      pacienteId: t.paciente.id,
      profesionalId: t.profesional.id,
      salaId: t.sala?.id ?? '',
      fecha: t.fecha,
      hora: t.hora,
      duracionMin: t.duracionMin,
      observaciones: t.observaciones ?? '',
    };
    this.errorPanel.set(null);
    this.panel.set('editar');
  }

  protected cerrarPanel(): void {
    this.panel.set(null);
    this.seleccionado.set(null);
  }

  protected async buscarPacientes(): Promise<void> {
    try {
      const r = await this.pacientesApi.listar({ q: this.busquedaPaciente, porPagina: 50 });
      this.pacientes.set(r.items);
      if (r.items.length === 1) this.form.pacienteId = r.items[0].id;
    } catch {
      this.pacientes.set([]);
    }
  }

  protected async guardarNuevo(): Promise<void> {
    const f = this.form;
    if (!f.pacienteId || !f.profesionalId || !f.fecha || !f.hora || !f.duracionMin) {
      this.errorPanel.set('Completá paciente, profesional, fecha, hora y duración.');
      return;
    }
    this.guardando.set(true);
    this.errorPanel.set(null);
    try {
      const base = {
        pacienteId: f.pacienteId,
        profesionalId: f.profesionalId,
        salaId: f.salaId || null,
        hora: f.hora,
        duracionMin: Number(f.duracionMin),
        observaciones: f.observaciones || null,
      };
      if (f.repetir) {
        const r = await this.turnosApi.crearRecurrencia({
          ...base,
          diaSemana: diaSemana(f.fecha),
          fechaDesde: f.fecha,
          fechaHasta: f.repetirHasta || undefined,
        });
        this.aviso.set(
          `Se agendaron ${r.creados.length} turno(s) semanales.` +
            (r.conflictos.length
              ? ` No se agendaron ${r.conflictos.length}: ` +
                r.conflictos.map((c) => `${fechaLarga(c.fecha)} (${c.motivo})`).join('; ')
              : ''),
        );
      } else {
        await this.turnosApi.crear({ ...base, fecha: f.fecha });
        this.aviso.set('Turno agendado.');
      }
      this.cerrarPanel();
      await this.cargar();
    } catch (e) {
      this.errorPanel.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async guardarCambios(): Promise<void> {
    const t = this.seleccionado();
    if (!t) return;
    const f = this.form;
    this.guardando.set(true);
    this.errorPanel.set(null);
    try {
      const actualizado = await this.turnosApi.mover(t.id, {
        fecha: f.fecha,
        hora: f.hora,
        duracionMin: Number(f.duracionMin),
        salaId: f.salaId || null,
        ...(this.esProfesional() ? {} : { profesionalId: f.profesionalId }),
        observaciones: f.observaciones || null,
      });
      this.aviso.set('Turno actualizado.');
      this.seleccionado.set(actualizado);
      this.panel.set('detalle');
      await this.cargar();
    } catch (e) {
      this.errorPanel.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async cancelar(): Promise<void> {
    const t = this.seleccionado();
    if (!t) return;
    this.guardando.set(true);
    this.errorPanel.set(null);
    try {
      await this.turnosApi.cancelar(t.id, this.motivoCancelacion);
      this.aviso.set('Turno cancelado.');
      this.cerrarPanel();
      await this.cargar();
    } catch (e) {
      this.errorPanel.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async terminarSemanales(): Promise<void> {
    const t = this.seleccionado();
    if (!t?.recurrenciaId) return;
    this.guardando.set(true);
    this.errorPanel.set(null);
    try {
      const r = await this.turnosApi.finalizarRecurrencia(t.recurrenciaId, t.fecha);
      this.aviso.set(
        `Se cancelaron ${r.cancelados} turno(s) semanales desde ${fechaLarga(t.fecha)}.`,
      );
      this.cerrarPanel();
      await this.cargar();
    } catch (e) {
      this.errorPanel.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  protected fechaLarga = fechaLarga;
  protected diaSemanaDe = (fecha: string) => NOMBRE_DIA[diaSemana(fecha) - 1];

  private formVacio(): FormTurno {
    return {
      pacienteId: '',
      profesionalId: '',
      salaId: '',
      fecha: this.fecha?.() ?? '',
      hora: '09:00',
      duracionMin: 45,
      observaciones: '',
      repetir: false,
      repetirHasta: '',
    };
  }
}

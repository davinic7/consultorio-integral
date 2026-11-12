import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AsistenciaApi,
  CobrosApi,
  FinanciadoresApi,
  mensajeDeError,
  OrdenesApi,
  PacientesApi,
  ProfesionalesApi,
} from '../../core/api/api';
import type {
  DatosPaciente,
  Financiador,
  HistorialAsistencia,
  Orden,
  Paciente,
  Prestacion,
  Profesional,
} from '../../core/api/modelos';
import { NOMBRE_ESTADO } from '../../core/asistencia';
import { plata } from '../../core/cobros';
import { edad, enlaceWhatsApp } from '../../core/contacto';
import { colorDisciplina, iniciales } from '../../core/disciplina';
import { ahoraEn, fechaLarga, lunesDe, minutos } from '../../core/fechas';
import { AuthService } from '../../core/auth/auth.service';
import { tieneModulo } from '../../core/auth/modulos';
import { puede } from '../../core/auth/roles';
import { AsistenciaPaciente } from './asistencia-paciente';
import { ExpedientePaciente } from './expediente-paciente';
import { PagosPaciente } from './pagos-paciente';

type Pestana = 'resumen' | 'sesiones' | 'pagos' | 'expediente' | 'datos';

/** Vencimiento de CUD solo si tiene CUD. */
function cudCoherente(g: AbstractControl): ValidationErrors | null {
  const { tieneCud, cudVencimiento } = g.value as { tieneCud: boolean; cudVencimiento: string };
  return !tieneCud && cudVencimiento ? { cud: true } : null;
}

const vacioANull = (s: string) => (s.trim() === '' ? null : s.trim());

@Component({
  selector: 'app-paciente-ficha',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    NgTemplateOutlet,
    AsistenciaPaciente,
    ExpedientePaciente,
    PagosPaciente,
  ],
  templateUrl: './paciente-ficha.html',
  styleUrl: './paciente-ficha.scss',
})
export class PacienteFicha implements OnInit {
  /** Id de la ruta (/pacientes/:id); sin id es un alta. */
  readonly id = input<string>();

  private readonly api = inject(PacientesApi);
  private readonly profesionalesApi = inject(ProfesionalesApi);
  private readonly asistenciaApi = inject(AsistenciaApi);
  private readonly financiadoresApi = inject(FinanciadoresApi);
  private readonly cobrosApi = inject(CobrosApi);
  private readonly ordenesApi = inject(OrdenesApi);
  protected readonly financiadores = signal<Financiador[]>([]);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly puedeEditar = computed(() =>
    puede(this.auth.sesion()?.rol, 'admin', 'recepcion'),
  );
  protected readonly esAlta = computed(() => !this.id());
  /** El plan del centro incluye cobros (pestaña Pagos y saldo) y obras sociales (órdenes). */
  protected readonly conCobros = computed(() => tieneModulo(this.auth.sesion(), 'cobros'));
  private readonly conOrdenes = computed(() => tieneModulo(this.auth.sesion(), 'obras_sociales'));
  protected readonly esProfesional = computed(() => this.auth.sesion()?.rol === 'profesional');
  /**
   * Escribe notas: un profesional, o un admin que también atiende (trabaja solo),
   * si el plan incluye las notas de sesión.
   */
  protected readonly escribeNotas = computed(() => {
    const s = this.auth.sesion();
    if (!tieneModulo(s, 'notas')) return false;
    return s?.rol === 'profesional' || (s?.rol === 'admin' && !!s.atiende);
  });
  protected readonly paciente = signal<Paciente | null>(null);
  protected readonly profesionales = signal<Profesional[]>([]);
  protected readonly asignados = signal<Set<string>>(new Set());
  protected readonly cargando = signal(true);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly guardado = signal(false);
  protected readonly historial = signal<HistorialAsistencia | null>(null);
  protected readonly prestaciones = signal<Prestacion[]>([]);
  protected readonly ordenes = signal<Orden[]>([]);
  protected readonly pestana = signal<Pestana>('resumen');
  protected readonly pestanas = computed(() => {
    const p: { id: Pestana; texto: string }[] = [
      { id: 'resumen', texto: 'Resumen' },
      { id: 'sesiones', texto: 'Sesiones' },
    ];
    if (this.conCobros()) p.push({ id: 'pagos', texto: 'Pagos' });
    if (this.escribeNotas()) p.push({ id: 'expediente', texto: 'Expediente' });
    p.push({ id: 'datos', texto: this.puedeEditar() ? 'Editar datos' : 'Datos' });
    return p;
  });

  // ───────── Encabezado e indicadores ─────────

  protected readonly color = computed(() =>
    colorDisciplina(this.paciente()?.profesionales[0]?.disciplina),
  );
  protected readonly iniciales = computed(() => {
    const p = this.paciente();
    return p ? iniciales(p.nombre, p.apellido) : '';
  });
  protected readonly edad = computed(() => edad(this.paciente()?.fechaNacimiento));
  protected readonly disciplinas = computed(() => [
    ...new Set((this.paciente()?.profesionales ?? []).map((p) => p.disciplina)),
  ]);
  protected readonly whatsapp = computed(() => {
    const p = this.paciente();
    return enlaceWhatsApp(p?.telefono) ?? enlaceWhatsApp(p?.responsableTelefono);
  });
  /** Últimos 12 turnos con asistencia marcada, del más viejo al más nuevo. */
  protected readonly puntos = computed(() =>
    (this.historial()?.turnos ?? [])
      .filter((t) => t.estado !== 'pendiente' && t.estado !== 'cancelado_profesional')
      .slice(0, 12)
      .reverse(),
  );
  protected readonly proximo = computed(() => {
    const ahora = ahoraEn(this.auth.sesion()?.centro?.zonaHoraria);
    const futuros = (this.historial()?.turnos ?? []).filter(
      (t) =>
        t.estado === 'pendiente' &&
        (t.fecha > ahora.fecha || (t.fecha === ahora.fecha && minutos(t.horaFin) > ahora.minutos)),
    );
    return futuros.at(-1) ?? null; // el historial viene del más nuevo al más viejo
  });
  protected readonly porcentaje = computed(() => {
    const p = this.historial()?.resumen.porcentajeAsistencia;
    return p === null || p === undefined ? '—' : `${p}%`;
  });
  protected readonly sesionesDelMes = computed(() => {
    const mes = ahoraEn(this.auth.sesion()?.centro?.zonaHoraria).fecha.slice(0, 7);
    return (this.historial()?.turnos ?? []).filter(
      (t) => t.fecha.startsWith(mes) && t.estado !== 'cancelado_profesional',
    ).length;
  });
  /** Aviso del CUD: vencido o por vencer en los próximos 30 días. */
  protected readonly avisoCud = computed(() => {
    const p = this.paciente();
    if (!p?.tieneCud || !p.cudVencimiento) return null;
    const hoy = ahoraEn(this.auth.sesion()?.centro?.zonaHoraria).fecha;
    const dias = Math.round(
      (Date.parse(`${p.cudVencimiento}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000,
    );
    if (dias < 0)
      return { nivel: 'error', texto: `El CUD venció el ${this.fechaCorta(p.cudVencimiento)}.` };
    if (dias <= 30)
      return {
        nivel: 'aviso',
        texto: `El CUD vence el ${this.fechaCorta(p.cudVencimiento)} (en ${dias} días): conviene pedir la renovación.`,
      };
    return null;
  });
  /** Semanas con más sesiones de las que cubre la obra social. */
  protected readonly semanasExcedidas = computed(() => {
    const max = this.paciente()?.financiador?.maxSesionesSemana;
    if (!max) return [];
    const porSemana = new Map<string, number>();
    for (const t of this.historial()?.turnos ?? []) {
      if (t.estado === 'cancelado_profesional') continue;
      const lunes = lunesDe(t.fecha);
      porSemana.set(lunes, (porSemana.get(lunes) ?? 0) + 1);
    }
    return [...porSemana.entries()]
      .filter(([, n]) => n > max)
      .map(([lunes, n]) => ({ lunes, n }))
      .sort((a, b) => a.lunes.localeCompare(b.lunes));
  });
  /** Lo que falta cobrar de las sesiones asistidas. */
  protected readonly saldo = computed(() => {
    const deuda = this.prestaciones().filter((p) => p.saldo > 0);
    return { monto: deuda.reduce((a, p) => a + p.saldo, 0), sesiones: deuda.length };
  });
  /** Orden vigente con más lugar (si la obra social pide orden). */
  protected readonly orden = computed(() => {
    if (!this.conCobros() || !this.conOrdenes() || !this.paciente()?.financiador?.requiereOrden)
      return null;
    const vigentes = this.ordenes().filter((o) => o.vigente);
    return {
      vigente: vigentes.find((o) => o.disponibles > 0) ?? vigentes[0] ?? null,
      esperando: this.prestaciones().filter((p) => p.avisos.includes('falta_orden')).length,
    };
  });
  protected readonly plata = plata;
  protected readonly nombreEstado = NOMBRE_ESTADO;
  protected readonly fechaLarga = fechaLarga;
  protected readonly colorDe = colorDisciplina;
  protected readonly inicialesDe = iniciales;
  /** "2026-05-13" → "13/05/2026". */
  protected readonly fechaCorta = (f: string | null) =>
    f ? f.split('-').reverse().join('/') : '—';

  /** El financiador actual sigue en la lista (si se dio de baja, igual se muestra). */
  protected tieneFinanciador(id: string): boolean {
    return this.financiadores().some((f) => f.id === id);
  }

  protected elegirPestana(p: Pestana): void {
    this.pestana.set(p);
    this.guardado.set(false);
  }

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      nombre: ['', [Validators.required, Validators.maxLength(80)]],
      apellido: ['', [Validators.required, Validators.maxLength(80)]],
      dni: ['', Validators.pattern(/^[\d.\s-]{6,13}$/)],
      fechaNacimiento: [''],
      telefono: ['', Validators.maxLength(30)],
      email: ['', [Validators.email, Validators.maxLength(160)]],
      responsableNombre: ['', Validators.maxLength(120)],
      responsableTelefono: ['', Validators.maxLength(30)],
      financiadorId: [''],
      nroAfiliado: ['', Validators.maxLength(40)],
      tieneCud: [false],
      cudVencimiento: [''],
    },
    { validators: cudCoherente },
  );

  async ngOnInit(): Promise<void> {
    if (!this.puedeEditar()) this.form.disable();
    try {
      const [profesionales, paciente, financiadores] = await Promise.all([
        this.puedeEditar() ? this.profesionalesApi.listar() : Promise.resolve([]),
        this.id() ? this.api.obtener(this.id()!) : Promise.resolve(null),
        this.puedeEditar() ? this.financiadoresApi.listar() : Promise.resolve([]),
      ]);
      this.profesionales.set(profesionales);
      this.financiadores.set(financiadores);
      if (paciente) {
        this.mostrar(paciente);
        void this.cargarHistorial(paciente.id);
        void this.cargarCobros();
      }
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo cargar el paciente.'));
    } finally {
      this.cargando.set(false);
    }
  }

  protected alternarProfesional(id: string): void {
    this.asignados.update((s) => {
      const nuevo = new Set(s);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  protected async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.guardado.set(false);
    try {
      const v = this.form.getRawValue();
      const datos: DatosPaciente = {
        nombre: v.nombre.trim(),
        apellido: v.apellido.trim(),
        dni: vacioANull(v.dni),
        fechaNacimiento: vacioANull(v.fechaNacimiento),
        telefono: vacioANull(v.telefono),
        email: vacioANull(v.email),
        responsableNombre: vacioANull(v.responsableNombre),
        responsableTelefono: vacioANull(v.responsableTelefono),
        financiadorId: v.financiadorId || null,
        nroAfiliado: vacioANull(v.nroAfiliado),
        tieneCud: v.tieneCud,
        cudVencimiento: v.tieneCud ? vacioANull(v.cudVencimiento) : null,
      };
      const ids = [...this.asignados()];
      const actual = this.paciente();
      if (actual) {
        await this.api.actualizar(actual.id, datos);
        await this.api.asignarProfesionales(actual.id, ids);
        this.mostrar(await this.api.obtener(actual.id));
        this.guardado.set(true);
      } else {
        const creado = await this.api.crear({ ...datos, profesionalIds: ids });
        await this.router.navigate(['/pacientes', creado.id]);
      }
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async alternarActivo(): Promise<void> {
    const actual = this.paciente();
    if (!actual) return;
    try {
      this.mostrar(await this.api.actualizar(actual.id, { activo: !actual.activo }));
    } catch (e) {
      this.error.set(mensajeDeError(e));
    }
  }

  /** Sesiones para cobrar y órdenes del paciente (fallar no rompe la ficha). */
  protected async cargarCobros(): Promise<void> {
    const p = this.paciente();
    if (!p || !this.conCobros()) return;
    const [prestaciones, ordenes] = await Promise.all([
      this.cobrosApi.prestaciones({ pacienteId: p.id }).catch(() => []),
      p.financiador?.requiereOrden && this.conOrdenes()
        ? this.ordenesApi.listar(p.id).catch(() => [])
        : Promise.resolve([]),
    ]);
    this.prestaciones.set(prestaciones);
    this.ordenes.set(ordenes);
  }

  private async cargarHistorial(id: string): Promise<void> {
    try {
      this.historial.set(await this.asistenciaApi.historial(id));
    } catch {
      this.historial.set(null);
    }
  }

  private mostrar(p: Paciente): void {
    this.paciente.set(p);
    this.asignados.set(new Set(p.profesionales.map((x) => x.id)));
    this.form.reset({
      nombre: p.nombre,
      apellido: p.apellido,
      dni: p.dni ?? '',
      fechaNacimiento: p.fechaNacimiento ?? '',
      telefono: p.telefono ?? '',
      email: p.email ?? '',
      responsableNombre: p.responsableNombre ?? '',
      responsableTelefono: p.responsableTelefono ?? '',
      financiadorId: p.financiador?.id ?? '',
      nroAfiliado: p.nroAfiliado ?? '',
      tieneCud: p.tieneCud,
      cudVencimiento: p.cudVencimiento ?? '',
    });
  }
}

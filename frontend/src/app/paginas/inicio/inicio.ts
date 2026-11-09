import { Component, computed, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AvisosApi, PacientesApi, SalasApi, TurnosApi } from '../../core/api/api';
import type { Aviso, Sala, Turno } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { puede } from '../../core/auth/roles';
import { colorDisciplina, iniciales } from '../../core/disciplina';
import { ahoraEn, diaSemana, minutos, NOMBRE_DIA, sumarDias } from '../../core/fechas';

/** Franja horaria de "Salas en tiempo real". */
const DESDE_H = 8;
const HASTA_H = 20;
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

interface Bloque {
  turno: Turno;
  izquierda: number;
  ancho: number;
  clase: string;
  texto: string;
}

/**
 * Panel principal (Órbita Cian, docs/diseno/referencia/Panel.dc.html): indicadores
 * del día, salas en tiempo real, próximo turno, asistencia por profesional y avisos.
 * Todo sale de la agenda real; los indicadores de cobros llegan con el módulo de cobros.
 */
@Component({
  selector: 'app-inicio',
  imports: [RouterLink],
  templateUrl: './inicio.html',
  styleUrl: './inicio.scss',
})
export class Inicio {
  protected readonly auth = inject(AuthService);
  private readonly turnosApi = inject(TurnosApi);
  private readonly salasApi = inject(SalasApi);
  private readonly pacientesApi = inject(PacientesApi);
  private readonly avisosApi = inject(AvisosApi);

  private readonly zona = computed(() => this.auth.sesion()?.centro?.zonaHoraria);
  protected readonly recibeAvisos = computed(() =>
    puede(this.auth.sesion()?.rol, 'admin', 'recepcion'),
  );

  protected readonly ahora = signal(ahoraEn(this.zona()));
  protected readonly turnos = signal<Turno[]>([]);
  protected readonly semana = signal<number | null>(null);
  protected readonly pacientes = signal<number | null>(null);
  protected readonly salas = signal<Sala[]>([]);
  protected readonly avisos = signal<Aviso[]>([]);
  protected readonly cargando = signal(true);
  protected readonly error = signal(false);

  protected readonly horas = Array.from(
    { length: HASTA_H - DESDE_H },
    (_, i) => String(DESDE_H + i).padStart(2, '0'),
  );

  protected readonly fechaTitulo = computed(() => {
    const f = this.ahora().fecha;
    return `${NOMBRE_DIA[diaSemana(f) - 1].toUpperCase()} ${f.slice(8)} · ${MESES[Number(f.slice(5, 7)) - 1]}`;
  });
  protected readonly saludo = computed(() => {
    const h = this.ahora().minutos / 60;
    const nombre = (this.auth.sesion()?.usuario.nombre ?? '').split(/\s+/)[0];
    const s = h < 13 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
    return nombre ? `${s}, ${nombre}` : s;
  });

  // ───────── Indicadores ─────────

  protected readonly conteo = computed(() => {
    const c = { total: 0, presentes: 0, ausentes: 0, pendientes: 0 };
    for (const t of this.turnos()) {
      c.total++;
      if (t.estado === 'presente') c.presentes++;
      else if (t.estado === 'pendiente') c.pendientes++;
      else c.ausentes++;
    }
    return c;
  });
  /** Presentes sobre turnos con asistencia marcada. */
  protected readonly porcentaje = computed(() => {
    const c = this.conteo();
    const marcados = c.presentes + c.ausentes;
    return marcados ? Math.round((c.presentes * 100) / marcados) : null;
  });
  /** Largo del arco del anillo (circunferencia de r=18: 113,1). */
  protected readonly arco = computed(() => ((this.porcentaje() ?? 0) * 113.1) / 100);

  // ───────── Salas en tiempo real ─────────

  protected readonly filas = computed(() => {
    const porSala = new Map<string, Bloque[]>();
    for (const t of this.turnos()) {
      const clave = t.sala?.id ?? '';
      const lista = porSala.get(clave) ?? [];
      lista.push(this.bloque(t));
      porSala.set(clave, lista);
    }
    const filas = this.salas().map((s) => ({
      id: s.id,
      nombre: s.nombre,
      bloques: porSala.get(s.id) ?? [],
    }));
    const sinSala = porSala.get('');
    if (sinSala?.length) filas.push({ id: '', nombre: 'Sin sala', bloques: sinSala });
    return filas;
  });
  /** Posición de la línea "ahora" (null fuera de la franja). */
  protected readonly lineaAhora = computed(() => {
    const m = this.ahora().minutos;
    if (m < DESDE_H * 60 || m > HASTA_H * 60) return null;
    return ((m - DESDE_H * 60) / ((HASTA_H - DESDE_H) * 60)) * 100;
  });

  // ───────── Próximo turno y profesionales ─────────

  protected readonly proximo = computed(() => {
    const ahora = this.ahora().minutos;
    const t = this.turnos().find((x) => x.estado === 'pendiente' && minutos(x.horaFin) > ahora);
    if (!t) return null;
    const faltan = minutos(t.hora) - ahora;
    return {
      turno: t,
      cuando: faltan <= 0 ? 'EN CURSO' : faltan < 60 ? `EN ${faltan} MIN` : `A LAS ${t.hora}`,
      iniciales: iniciales(t.paciente.nombre, t.paciente.apellido),
      color: colorDisciplina(t.profesional.disciplina),
    };
  });

  protected readonly porProfesional = computed(() => {
    const m = new Map<
      string,
      { id: string; nombre: string; presentes: number; total: number; color: string }
    >();
    for (const t of this.turnos()) {
      const p = m.get(t.profesional.id) ?? {
        id: t.profesional.id,
        nombre: `${t.profesional.nombre} ${t.profesional.apellido}`,
        presentes: 0,
        total: 0,
        color: colorDisciplina(t.profesional.disciplina),
      };
      p.total++;
      if (t.estado === 'presente') p.presentes++;
      m.set(t.profesional.id, p);
    }
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre));
  });

  constructor() {
    effect(() => {
      const centro = this.auth.sesion()?.centro?.id;
      if (centro) untracked(() => void this.cargar());
      else this.cargando.set(false);
    });
    // La hora "en vivo" se mueve cada 30 s.
    const reloj = setInterval(() => this.ahora.set(ahoraEn(this.zona())), 30_000);
    inject(DestroyRef).onDestroy(() => clearInterval(reloj));
  }

  private bloque(t: Turno): Bloque {
    const total = (HASTA_H - DESDE_H) * 60;
    const ini = Math.max(minutos(t.hora) - DESDE_H * 60, 0);
    const fin = Math.min(minutos(t.horaFin) - DESDE_H * 60, total);
    const ahora = this.ahora().minutos;
    const enCurso = minutos(t.hora) <= ahora && ahora < minutos(t.horaFin);
    const ausente = t.estado === 'ausente_con_aviso' || t.estado === 'ausente_sin_aviso';
    const apellido = t.paciente.apellido;
    return {
      turno: t,
      izquierda: (ini / total) * 100,
      ancho: (Math.max(fin - ini, 0) / total) * 100,
      clase: ausente
        ? 'oc-turno--ausente'
        : `oc-turno--${colorDisciplina(t.profesional.disciplina)}${enCurso ? ' oc-turno--en-curso' : ''}`,
      texto: `${t.paciente.nombre[0]}. ${apellido}${ausente ? ' · ausente' : enCurso ? ' · en curso' : ''}`,
    };
  }

  private async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(false);
    const hoy = ahoraEn(this.zona()).fecha;
    try {
      const [turnos, semana, salas, pacientes] = await Promise.all([
        this.turnosApi.listar({ desde: hoy, hasta: hoy }),
        this.turnosApi.listar({ desde: hoy, hasta: sumarDias(hoy, 6) }),
        this.salasApi.listar(),
        this.pacientesApi.listar({ porPagina: 1 }),
      ]);
      this.turnos.set(turnos);
      this.semana.set(semana.length);
      this.salas.set(salas);
      this.pacientes.set(pacientes.total);
      if (this.recibeAvisos()) {
        const r = await this.avisosApi.listar();
        this.avisos.set(r.items.slice(0, 3));
      }
    } catch {
      this.error.set(true);
    } finally {
      this.cargando.set(false);
    }
  }
}

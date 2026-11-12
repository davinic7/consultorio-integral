import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PacientesApi, ProfesionalesApi, SalasApi, TurnosApi } from '../../core/api/api';
import type { Profesional, Turno } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { hoyEn } from '../../core/fechas';
import { Agenda } from './agenda';

const ZONA = 'America/Argentina/Catamarca';
const HOY = hoyEn(ZONA);
const PROF = { id: 'pr1', nombre: 'Laura', apellido: 'Ríos', disciplina: 'Psicología' };

function turno(extra: Partial<Turno> = {}): Turno {
  return {
    id: 't1',
    fecha: HOY,
    hora: '10:00',
    horaFin: '10:45',
    duracionMin: 45,
    inicio: `${HOY}T13:00:00.000Z`,
    fin: `${HOY}T13:45:00.000Z`,
    estado: 'pendiente',
    observaciones: null,
    recurrenciaId: null,
    paciente: { id: 'pa1', nombre: 'Tomás', apellido: 'Gil' },
    profesional: PROF,
    sala: null,
    ...extra,
  };
}

const profesional = (faltazoActivo: boolean): Profesional => ({
  ...PROF,
  matricula: null,
  usuarioId: null,
  activo: true,
  faltazo: { activo: faltazoActivo, toleranciaHoras: 24 },
});

describe('Agenda', () => {
  const turnos = { listar: vi.fn(), ocupacion: vi.fn(), marcarAsistencia: vi.fn() };
  const profesionales = { listar: vi.fn() };
  const salas = { listar: vi.fn() };
  let modulos: string[];

  beforeEach(() => {
    [
      turnos.listar,
      turnos.ocupacion,
      turnos.marcarAsistencia,
      profesionales.listar,
      salas.listar,
    ].forEach((f) => f.mockReset());
    turnos.listar.mockResolvedValue([turno()]);
    turnos.ocupacion.mockResolvedValue([]);
    profesionales.listar.mockResolvedValue([profesional(false)]);
    salas.listar.mockResolvedValue([
      { id: 's1', nombre: 'Sala 1', descripcion: null, activa: true },
    ]);
    modulos = ['agenda', 'asistencia', 'pacientes', 'salas'];
  });

  async function crear() {
    await TestBed.configureTestingModule({
      imports: [Agenda],
      providers: [
        provideRouter([]),
        { provide: TurnosApi, useValue: turnos },
        { provide: ProfesionalesApi, useValue: profesionales },
        { provide: SalasApi, useValue: salas },
        { provide: PacientesApi, useValue: { listar: vi.fn() } },
        {
          provide: AuthService,
          useValue: {
            sesion: () => ({
              rol: 'recepcion',
              usuario: { id: 'u1' },
              centro: { zonaHoraria: ZONA, modulos },
            }),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Agenda);
    fixture.detectChanges();
    // Primero profesionales y salas; después, los turnos.
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const boton = (el: HTMLElement, texto: string) =>
    Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith(texto));

  it('carga profesionales, salas y los turnos de la semana visible', async () => {
    const { el } = await crear();
    expect(profesionales.listar).toHaveBeenCalled();
    expect(salas.listar).toHaveBeenCalled();
    const { desde, hasta } = turnos.listar.mock.calls[0][0];
    // Semana completa: 7 días que incluyen hoy.
    const dias = (Date.parse(hasta) - Date.parse(desde)) / 86_400_000 + 1;
    expect(dias).toBe(7);
    expect(desde <= HOY && HOY <= hasta).toBe(true);
    expect(el.textContent).toContain('10:00 Gil');
  });

  it('con el módulo de salas muestra la vista por sala y el filtro', async () => {
    const { el } = await crear();
    expect(boton(el, 'Salas')).toBeTruthy();
    expect(el.querySelector('select[aria-label="Filtrar por sala"]')).not.toBeNull();
  });

  it('sin el módulo de salas (plan individual) no muestra nada de salas', async () => {
    modulos = ['agenda', 'asistencia', 'pacientes'];
    const { el } = await crear();
    expect(boton(el, 'Salas')).toBeUndefined();
    expect(el.querySelector('select[aria-label="Filtrar por sala"]')).toBeNull();
  });

  async function marcarConAviso(faltazoActivo: boolean, respuesta: boolean) {
    profesionales.listar.mockResolvedValue([profesional(faltazoActivo)]);
    turnos.marcarAsistencia.mockResolvedValue(turno({ estado: 'ausente_con_aviso' }));
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(respuesta);
    const { fixture, el } = await crear();
    (
      Array.from(el.querySelectorAll('button.turno')).find((b) =>
        b.textContent?.includes('Gil'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    (el.querySelector('button[data-estado="ausente_con_aviso"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    return confirmar;
  }

  it('con la regla de faltazo activa, "ausente con aviso" pregunta si avisó a tiempo', async () => {
    const confirmar = await marcarConAviso(true, false);
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('al menos 24 h'));
    expect(turnos.marcarAsistencia).toHaveBeenCalledWith('t1', 'ausente_con_aviso', true);
    confirmar.mockRestore();
  });

  it('sin la regla activa no pregunta nada', async () => {
    const confirmar = await marcarConAviso(false, true);
    expect(confirmar).not.toHaveBeenCalled();
    expect(turnos.marcarAsistencia).toHaveBeenCalledWith('t1', 'ausente_con_aviso', undefined);
    confirmar.mockRestore();
  });
});

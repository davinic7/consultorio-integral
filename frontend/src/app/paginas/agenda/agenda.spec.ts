import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PacientesApi, ProfesionalesApi, SalasApi, TurnosApi } from '../../core/api/api';
import type { Profesional, Turno } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { hoyEn, sumarDias } from '../../core/fechas';
import { Agenda } from './agenda';

const ZONA = 'America/Argentina/Catamarca';
const HOY = hoyEn(ZONA);
const MANANA = sumarDias(HOY, 1);
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
  const turnos = {
    listar: vi.fn(),
    ocupacion: vi.fn(),
    marcarAsistencia: vi.fn(),
    mover: vi.fn(),
  };
  const profesionales = { listar: vi.fn() };
  const salas = { listar: vi.fn() };
  const pacientes = { listar: vi.fn(), obtener: vi.fn() };
  let modulos: string[];

  beforeEach(() => {
    [
      ...Object.values(turnos),
      profesionales.listar,
      salas.listar,
      ...Object.values(pacientes),
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
        { provide: PacientesApi, useValue: pacientes },
        {
          provide: AuthService,
          useValue: {
            sesion: () => ({
              rol: 'recepcion',
              usuario: { id: 'u1' },
              centro: { nombre: 'Centro Norte', zonaHoraria: ZONA, modulos },
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

  /** Evento de arrastre con la altura del puntero (jsdom no trae DragEvent). */
  const arrastre = (tipo: string, clientY: number) =>
    Object.assign(new Event(tipo, { bubbles: true, cancelable: true }), {
      clientY,
      dataTransfer: null,
    });
  const bloqueDe = (el: HTMLElement, apellido: string) =>
    Array.from(el.querySelectorAll('button.turno')).find((b) =>
      b.textContent?.includes(apellido),
    ) as HTMLButtonElement;

  it('arrastrar un turno a otra hora lo mueve, con la misma duración, tras confirmar', async () => {
    turnos.mover.mockResolvedValue(turno({ hora: '11:00' }));
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, el } = await crear();
    const bloque = bloqueDe(el, 'Gil');
    expect(bloque.getAttribute('draggable')).toBe('true');
    const columna = bloque.closest('.calendario__columna')!;
    // Agarrado 10 px abajo de su borde; soltado a 250 px de la grilla (07:00 + 4 h).
    bloque.dispatchEvent(arrastre('dragstart', 10));
    columna.dispatchEvent(arrastre('dragover', 250));
    columna.dispatchEvent(arrastre('drop', 250));
    await fixture.whenStable();
    expect(confirmar).toHaveBeenCalledWith(expect.stringContaining('11:00'));
    expect(turnos.mover).toHaveBeenCalledWith('t1', {
      fecha: HOY,
      hora: '11:00',
      duracionMin: 45,
      salaId: null,
    });
    confirmar.mockRestore();
  });

  it('si no se confirma, o cae en el mismo lugar, no se mueve', async () => {
    const confirmar = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { fixture, el } = await crear();
    const bloque = bloqueDe(el, 'Gil');
    const columna = bloque.closest('.calendario__columna')!;
    bloque.dispatchEvent(arrastre('dragstart', 0));
    columna.dispatchEvent(arrastre('drop', 250));
    // 180 px = 10:00, donde ya está: ni pregunta.
    bloque.dispatchEvent(arrastre('dragstart', 0));
    columna.dispatchEvent(arrastre('drop', 180));
    await fixture.whenStable();
    expect(confirmar).toHaveBeenCalledTimes(1);
    expect(turnos.mover).not.toHaveBeenCalled();
    confirmar.mockRestore();
  });

  it('un turno ya marcado no se puede arrastrar', async () => {
    turnos.listar.mockResolvedValue([turno({ estado: 'presente' })]);
    const { el } = await crear();
    expect(bloqueDe(el, 'Gil').getAttribute('draggable')).toBeNull();
  });

  it('recordar los turnos de mañana: un enlace de WhatsApp por turno, o sin teléfono', async () => {
    const { fixture, el } = await crear();
    turnos.listar.mockResolvedValue([
      turno({ id: 'm1', fecha: MANANA, hora: '11:00' }),
      turno({
        id: 'm2',
        fecha: MANANA,
        hora: '09:00',
        paciente: { id: 'pa2', nombre: 'Lía', apellido: 'Sol' },
      }),
      turno({ id: 'm3', fecha: MANANA, estado: 'cancelado_profesional' }),
    ]);
    pacientes.obtener.mockImplementation(async (id: string) => ({
      nombre: id === 'pa1' ? 'Tomás' : 'Lía',
      telefono: id === 'pa1' ? '3834123456' : null,
      responsableNombre: null,
      responsableTelefono: null,
    }));
    (
      Array.from(el.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Recordar los turnos de mañana'),
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    // Pide solo mañana.
    const pedido = turnos.listar.mock.calls.at(-1)![0];
    expect(pedido).toMatchObject({ desde: MANANA, hasta: MANANA });
    const filas = Array.from(el.querySelectorAll('.agenda-recordatorios .lista__item'));
    // Ordenados por hora; el cancelado no aparece.
    expect(filas.map((f) => f.textContent?.trim().slice(0, 5))).toEqual(['09:00', '11:00']);
    expect(filas[0].textContent).toContain('Sin teléfono');
    const enlace = filas[1].querySelector('a')!.getAttribute('href')!;
    expect(enlace.startsWith('https://wa.me/5493834123456?text=')).toBe(true);
    expect(decodeURIComponent(enlace)).toContain(
      'mañana a las 11:00 con Laura Ríos en Centro Norte',
    );
  });

  it('desde el turno, "Recordar por WhatsApp" abre el mensaje listo', async () => {
    pacientes.obtener.mockResolvedValue({
      nombre: 'Tomás',
      telefono: '3834123456',
      responsableNombre: null,
      responsableTelefono: null,
    });
    const abrir = vi.spyOn(window, 'open').mockReturnValue(null);
    const { fixture, el } = await crear();
    bloqueDe(el, 'Gil').click();
    fixture.detectChanges();
    (
      Array.from(el.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Recordar por WhatsApp'),
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(pacientes.obtener).toHaveBeenCalledWith('pa1');
    expect(abrir).toHaveBeenCalledWith(
      expect.stringContaining('https://wa.me/5493834123456?text='),
      '_blank',
      'noopener',
    );
    abrir.mockRestore();
  });
});

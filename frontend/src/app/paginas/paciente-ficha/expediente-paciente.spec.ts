import { TestBed } from '@angular/core/testing';
import { NotasApi } from '../../core/api/api';
import type { Nota } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { ExpedientePaciente } from './expediente-paciente';

const ZONA = 'America/Argentina/Catamarca';
const HOY = '2026-11-12';

function nota(datos: Partial<Nota> & { id: string }): Nota {
  return {
    texto: 'Motivo\nSeguimiento de fonemas vibrantes.',
    compartida: false,
    origen: 'escrita',
    propia: true,
    profesional: { id: 'p1', nombre: 'Gabriela', apellido: 'Molina', disciplina: 'Fonoaudiología' },
    turno: null,
    creadaEn: '2026-11-09T14:52:00Z',
    actualizadaEn: '2026-11-09T14:52:00Z',
    editadaEn: null,
    ...datos,
  };
}

const PROPIA = nota({ id: 'a', origen: 'dictada', creadaEn: '2026-11-11T14:00:00Z' });
const AJENA = nota({
  id: 'b',
  propia: false,
  compartida: true,
  texto: 'Lectura de sílabas complejas.',
  profesional: { id: 'p2', nombre: 'Rocío', apellido: 'Herrera', disciplina: 'Psicopedagogía' },
  creadaEn: '2026-11-06T18:30:00Z',
});

describe('Expediente del paciente', () => {
  const api = {
    listar: vi.fn(),
    sesiones: vi.fn(),
    borrador: vi.fn(),
    crear: vi.fn(),
    editar: vi.fn(),
    guardarBorrador: vi.fn(),
    descartarBorrador: vi.fn(),
  };

  beforeEach(async () => {
    Object.values(api).forEach((f) => f.mockReset());
    api.sesiones.mockResolvedValue({
      hoy: HOY,
      turnos: [
        {
          id: 't-hoy',
          fecha: HOY,
          hora: '11:00',
          inicio: '2026-11-12T14:00:00Z',
          estadoAsistencia: 'pendiente',
          sala: { id: 's', nombre: 'Sala 2' },
          conNota: false,
        },
      ],
    });
    api.borrador.mockResolvedValue({ borrador: null });
    api.guardarBorrador.mockImplementation(
      async (_id: string, d: { texto: string; compartida: boolean; turnoId: string | null }) => ({
        borrador: { ...d, origen: 'escrita', actualizadoEn: '2026-11-12T14:52:00Z' },
      }),
    );
    try {
      localStorage.removeItem('ci-expediente-guia');
    } catch {
      // sin almacenamiento
    }
    await TestBed.configureTestingModule({
      imports: [ExpedientePaciente],
      providers: [
        { provide: NotasApi, useValue: api },
        { provide: AuthService, useValue: { sesion: () => ({ centro: { zonaHoraria: ZONA } }) } },
      ],
    }).compileComponents();
  });

  const pausa = (ms = 0) => new Promise((r) => setTimeout(r, ms));

  /** Deja terminar las respuestas simuladas y lo que ngModel escribe en los campos. */
  async function refrescar(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
    fixture.detectChanges();
    await pausa();
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
  }

  async function crear() {
    const fixture = TestBed.createComponent(ExpedientePaciente);
    fixture.componentRef.setInput('pacienteId', 'pac-1');
    fixture.componentRef.setInput('nombre', 'Lucía');
    await refrescar(fixture);
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('sin evoluciones invita a escribir la primera', async () => {
    api.listar.mockResolvedValue([]);
    const { el } = await crear();
    expect(el.textContent).toContain('Todavía no hay evoluciones de Lucía');
    expect(el.querySelector('.exp__filtros')).toBeNull();
  });

  it('agrupa por mes y distingue las del equipo, que no se editan', async () => {
    api.listar.mockResolvedValue([AJENA, PROPIA]);
    const { el } = await crear();
    expect(el.querySelector('.exp__mes')?.textContent).toContain('noviembre 2026');
    const items = Array.from(el.querySelectorAll('li.evo'));
    expect(items.map((i) => i.querySelector('.evo__fecha')?.textContent?.trim())).toEqual([
      'mié 11/11 · 11:00',
      'vie 06/11 · 15:30',
    ]);
    expect(items[0].textContent).toContain('Privada');
    expect(items[0].textContent).toContain('Dictada');
    expect(items[0].textContent).toContain('Editar');
    expect(items[1].classList).toContain('evo--ajena');
    expect(items[1].textContent).toContain('Del equipo · solo lectura');
    expect(items[1].textContent).not.toContain('Editar');
  });

  it('filtra las del equipo', async () => {
    api.listar.mockResolvedValue([AJENA, PROPIA]);
    const { fixture, el } = await crear();
    const delEquipo = Array.from(el.querySelectorAll('.exp__filtros button')).find(
      (b) => b.textContent?.trim() === 'Del equipo',
    ) as HTMLButtonElement;
    delEquipo.click();
    await refrescar(fixture);
    expect(el.querySelectorAll('li.evo')).toHaveLength(1);
    expect(el.textContent).toContain('1 evolución · 0 tuyas · 1 del equipo');
  });

  it('escribe con la guía y el turno de hoy, guarda el borrador solo y suma la evolución arriba', async () => {
    api.listar.mockResolvedValue([]);
    api.crear.mockImplementation(async (_id: string, d: { texto: string }) =>
      nota({
        id: 'nueva',
        texto: d.texto,
        turno: { id: 't-hoy', inicio: '2026-11-12T14:00:00Z', sala: 'Sala 2' },
      }),
    );
    const { fixture, el } = await crear();
    (el.querySelector('.exp__vacio button') as HTMLButtonElement).click();
    await refrescar(fixture);

    const texto = el.querySelector('#texto-evolucion') as HTMLTextAreaElement;
    expect(texto.value).toBe('Motivo\n\nDesarrollo de la sesión\n\nObservaciones\n\nPlan\n');
    expect((el.querySelector('select') as HTMLSelectElement).value).toBe('t-hoy');

    texto.value = 'Motivo\nControl de fonemas.\n\nPlan\n';
    texto.dispatchEvent(new Event('input'));
    expect(api.guardarBorrador).not.toHaveBeenCalled();
    // El borrador se guarda solo, un momento después de dejar de escribir.
    await pausa(1600);
    expect(api.guardarBorrador).toHaveBeenCalledWith('pac-1', {
      texto: 'Motivo\nControl de fonemas.\n\nPlan\n',
      compartida: false,
      turnoId: 't-hoy',
      origen: 'escrita',
    });

    (el.querySelector('.pan__guardar') as HTMLButtonElement).click();
    await refrescar(fixture);
    expect(api.crear).toHaveBeenCalledWith('pac-1', {
      texto: 'Motivo\nControl de fonemas.',
      compartida: false,
      turnoId: 't-hoy',
      origen: 'escrita',
    });
    expect(el.textContent).toContain('Evolución guardada y cifrada. La ves solo vos.');
    expect(el.querySelectorAll('li.evo')).toHaveLength(1);
  });

  it('no guarda una evolución que solo tiene los títulos', async () => {
    api.listar.mockResolvedValue([]);
    const { fixture, el } = await crear();
    (el.querySelector('.exp__vacio button') as HTMLButtonElement).click();
    await refrescar(fixture);
    (el.querySelector('.pan__guardar') as HTMLButtonElement).click();
    await refrescar(fixture);
    expect(api.crear).not.toHaveBeenCalled();
    expect(el.textContent).toContain('La evolución está vacía');
  });

  it('muestra el borrador guardado y lo retoma', async () => {
    api.listar.mockResolvedValue([PROPIA]);
    api.borrador.mockResolvedValue({
      borrador: {
        texto: 'Observaciones\nVino cansada.',
        compartida: true,
        origen: 'escrita',
        turnoId: null,
        actualizadoEn: '2026-11-12T13:10:00Z',
      },
    });
    const { fixture, el } = await crear();
    expect(el.querySelector('.exp__borrador')?.textContent).toContain(
      'Observaciones: Vino cansada.',
    );
    (el.querySelector('.exp__borrador button') as HTMLButtonElement).click();
    await refrescar(fixture);
    expect((el.querySelector('#texto-evolucion') as HTMLTextAreaElement).value).toBe(
      'Observaciones\nVino cansada.',
    );
    expect(el.querySelector('.pan__opcion[aria-pressed="true"]')?.textContent).toContain(
      'Compartida',
    );
  });
});

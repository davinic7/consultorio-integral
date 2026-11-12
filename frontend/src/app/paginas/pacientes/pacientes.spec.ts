import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PacientesApi } from '../../core/api/api';
import type { Paciente } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { Pacientes } from './pacientes';

const paciente = (id: string, apellido: string, extra: Partial<Paciente> = {}): Paciente =>
  ({
    id,
    nombre: 'Ana',
    apellido,
    dni: '30111222',
    telefono: null,
    activo: true,
    tieneCud: false,
    profesionales: [],
    ...extra,
  }) as Paciente;

describe('Pacientes', () => {
  const api = { listar: vi.fn() };
  let rol = 'recepcion';

  beforeEach(async () => {
    vi.useRealTimers();
    api.listar.mockReset();
    rol = 'recepcion';
    api.listar.mockResolvedValue({
      items: [
        paciente('p1', 'Paz', {
          tieneCud: true,
          profesionales: [{ id: 'x', nombre: 'Laura', apellido: 'Ríos' }],
        } as Partial<Paciente>),
        paciente('p2', 'Sosa', { activo: false }),
      ],
      total: 2,
    });
    await TestBed.configureTestingModule({
      imports: [Pacientes],
      providers: [
        provideRouter([]),
        { provide: PacientesApi, useValue: api },
        { provide: AuthService, useValue: { sesion: () => ({ rol }) } },
      ],
    }).compileComponents();
  });

  async function crear() {
    const fixture = TestBed.createComponent(Pacientes);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('carga la primera página y muestra CUD, baja y profesionales', async () => {
    const { el } = await crear();
    expect(api.listar).toHaveBeenCalledWith({
      q: '',
      pagina: 1,
      porPagina: 20,
      incluirInactivos: undefined,
    });
    expect(el.textContent).toContain('Paz, Ana');
    expect(el.textContent).toContain('CUD');
    expect(el.textContent).toContain('De baja');
    expect(el.textContent).toContain('Ríos');
    expect(el.textContent).toContain('Sin profesional');
  });

  it('recepción puede dar de alta; el profesional ve solo los suyos', async () => {
    let { el } = await crear();
    expect(el.textContent).toContain('Nuevo paciente');
    TestBed.resetTestingModule();
    rol = 'profesional';
    await TestBed.configureTestingModule({
      imports: [Pacientes],
      providers: [
        provideRouter([]),
        { provide: PacientesApi, useValue: api },
        { provide: AuthService, useValue: { sesion: () => ({ rol }) } },
      ],
    }).compileComponents();
    ({ el } = await crear());
    expect(el.textContent).not.toContain('Nuevo paciente');
    expect(el.textContent).toContain('Ves los pacientes que tenés asignados.');
  });

  it('busca con una pausa (no un pedido por tecla) y vuelve a la página 1', async () => {
    vi.useFakeTimers();
    const fixture = TestBed.createComponent(Pacientes);
    fixture.detectChanges();
    await vi.runAllTimersAsync();
    api.listar.mockClear();
    const buscador = fixture.nativeElement.querySelector('input[type=search]') as HTMLInputElement;
    for (const texto of ['p', 'pa', 'paz']) {
      buscador.value = texto;
      buscador.dispatchEvent(new Event('input'));
    }
    await vi.advanceTimersByTimeAsync(350);
    expect(api.listar).toHaveBeenCalledTimes(1);
    expect(api.listar).toHaveBeenCalledWith(expect.objectContaining({ q: 'paz', pagina: 1 }));
    vi.useRealTimers();
  });

  it('pagina de a 20', async () => {
    api.listar.mockResolvedValue({ items: [paciente('p1', 'Paz')], total: 45 });
    const { fixture, el } = await crear();
    expect(el.textContent).toContain('Página 1 de 3');
    const siguiente = Array.from(el.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Siguiente'),
    )!;
    siguiente.click();
    await fixture.whenStable();
    expect(api.listar).toHaveBeenLastCalledWith(expect.objectContaining({ pagina: 2 }));
  });
});

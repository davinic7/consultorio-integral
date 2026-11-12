import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { ProfesionalesApi, UsuariosApi } from '../../core/api/api';
import type { Profesional } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { Profesionales } from './profesionales';

const prof = (id: string, apellido: string, extra: Partial<Profesional> = {}): Profesional => ({
  id,
  nombre: 'Ana',
  apellido,
  disciplina: 'Psicología',
  matricula: null,
  usuarioId: null,
  activo: true,
  faltazo: { activo: false, toleranciaHoras: 24 },
  ...extra,
});

describe('Profesionales', () => {
  const api = { listar: vi.fn(), crear: vi.fn(), actualizar: vi.fn() };
  const usuarios = { listar: vi.fn() };
  let sesion: { rol: string; usuario: { id: string }; centro: { modulos: string[] } };

  async function crear() {
    await TestBed.configureTestingModule({
      imports: [Profesionales],
      providers: [
        { provide: ProfesionalesApi, useValue: api },
        { provide: UsuariosApi, useValue: usuarios },
        { provide: AuthService, useValue: { sesion: () => sesion } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Profesionales);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  const fila = (el: HTMLElement, texto: string) =>
    Array.from(el.querySelectorAll('.lista__item')).find((f) => f.textContent?.includes(texto))!;
  const botones = (f: Element) =>
    Array.from(f.querySelectorAll('button')).map((b) => b.textContent?.trim());

  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    usuarios.listar.mockReset();
    api.listar.mockResolvedValue([
      prof('p1', 'Ríos', { usuarioId: 'u-prof' }),
      prof('p2', 'Paz', { matricula: 'MP 123' }),
    ]);
    usuarios.listar.mockResolvedValue([
      {
        id: 'm1',
        rol: 'profesional',
        activo: true,
        usuario: { id: 'u-prof', email: 'rios@centro.com', nombre: 'Ríos', activo: true },
      },
    ]);
    sesion = {
      rol: 'admin',
      usuario: { id: 'u-admin' },
      centro: { modulos: ['agenda', 'pacientes', 'cobros', 'liquidacion'] },
    };
  });

  it('el admin ve todas las acciones y la cuenta vinculada', async () => {
    const { el } = await crear();
    expect(el.textContent).toContain('Nuevo profesional');
    expect(fila(el, 'Ríos').textContent).toContain('rios@centro.com');
    expect(fila(el, 'Paz').textContent).toContain('Mat. MP 123');
    expect(botones(fila(el, 'Paz'))).toEqual(['Faltazos', 'Editar', 'Acuerdo', 'Dar de baja']);
  });

  it('sin el módulo de liquidación no hay acuerdos; sin cobros, no hay faltazos', async () => {
    sesion.centro.modulos = ['agenda', 'pacientes'];
    const { el } = await crear();
    expect(botones(fila(el, 'Paz'))).toEqual(['Editar', 'Dar de baja']);
  });

  it('el profesional solo ve la regla de faltazo de su propia ficha', async () => {
    sesion = { ...sesion, rol: 'profesional', usuario: { id: 'u-prof' } };
    const { el } = await crear();
    expect(el.textContent).not.toContain('Nuevo profesional');
    expect(usuarios.listar).not.toHaveBeenCalled();
    expect(botones(fila(el, 'Ríos'))).toEqual(['Faltazos']);
    expect(botones(fila(el, 'Paz'))).toEqual([]);
  });

  it('crea un profesional y vincula la cuenta elegida', async () => {
    api.crear.mockResolvedValue(prof('p3', 'Luna'));
    const { fixture, el } = await crear();
    (
      Array.from(el.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Nuevo profesional'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const form = el.querySelector('form')!;
    const campos = Array.from(form.querySelectorAll('input')) as HTMLInputElement[];
    const valores = ['Pía', 'Luna', 'Fonoaudiología', ''];
    campos.slice(0, 4).forEach((c, i) => {
      c.value = valores[i];
      c.dispatchEvent(new Event('input'));
    });
    const cuenta = form.querySelector('select') as HTMLSelectElement;
    cuenta.value = cuenta.options[1].value;
    cuenta.dispatchEvent(new Event('change'));
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(api.crear).toHaveBeenCalledWith({
      nombre: 'Pía',
      apellido: 'Luna',
      disciplina: 'Fonoaudiología',
      matricula: '',
      usuarioId: 'u-prof',
    });
  });

  it('no guarda sin nombre, apellido y disciplina', async () => {
    const { fixture, el } = await crear();
    (
      Array.from(el.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Nuevo profesional'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
    expect(api.crear).not.toHaveBeenCalled();
    expect(el.textContent).toContain('Completá nombre, apellido y disciplina.');
  });

  it('muestra el límite del plan al dar de alta', async () => {
    api.crear.mockRejectedValue(
      new HttpErrorResponse({
        status: 403,
        error: { message: 'El plan Individual permite hasta 1 profesional activo' },
      }),
    );
    const { fixture, el } = await crear();
    (
      Array.from(el.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Nuevo profesional'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const campos = Array.from(el.querySelectorAll('form input')) as HTMLInputElement[];
    ['A', 'B', 'C'].forEach((v, i) => {
      campos[i].value = v;
      campos[i].dispatchEvent(new Event('input'));
    });
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain(
      'permite hasta 1 profesional activo',
    );
  });
});

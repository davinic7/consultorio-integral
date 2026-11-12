import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { SalasApi } from '../../core/api/api';
import type { Sala } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { Salas } from './salas';

const sala = (id: string, nombre: string, activa = true): Sala =>
  ({ id, nombre, descripcion: null, activa }) as Sala;

describe('Salas', () => {
  const api = { listar: vi.fn(), crear: vi.fn(), actualizar: vi.fn() };
  let rol = 'admin';

  beforeEach(async () => {
    Object.values(api).forEach((f) => f.mockReset());
    rol = 'admin';
    api.listar.mockResolvedValue([sala('s1', 'Sala 1'), sala('s2', 'Consultorio azul')]);
    await TestBed.configureTestingModule({
      imports: [Salas],
      providers: [
        { provide: SalasApi, useValue: api },
        { provide: AuthService, useValue: { sesion: () => ({ rol }) } },
      ],
    }).compileComponents();
  });

  async function crear() {
    const fixture = TestBed.createComponent(Salas);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function escribir(input: HTMLInputElement, valor: string) {
    input.value = valor;
    input.dispatchEvent(new Event('input'));
  }

  it('lista las salas y el admin ve el formulario y las acciones', async () => {
    const { el } = await crear();
    expect(api.listar).toHaveBeenCalledWith(false);
    expect(el.textContent).toContain('Consultorio azul');
    expect(el.querySelector('form')).not.toBeNull();
    expect(el.textContent).toContain('Dar de baja');
  });

  it('recepción y profesionales solo miran', async () => {
    rol = 'recepcion';
    const { el } = await crear();
    expect(el.textContent).toContain('Sala 1');
    expect(el.querySelector('form')).toBeNull();
    expect(el.textContent).not.toContain('Dar de baja');
  });

  it('no agrega una sala sin nombre', async () => {
    const { fixture, el } = await crear();
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.crear).not.toHaveBeenCalled();
    expect(el.textContent).toContain('El nombre es obligatorio.');
  });

  it('agrega una sala y recarga la lista', async () => {
    api.crear.mockResolvedValue(sala('s3', 'Sala 3'));
    const { fixture, el } = await crear();
    const [nombre, descripcion] = Array.from(
      el.querySelectorAll('form input'),
    ) as HTMLInputElement[];
    escribir(nombre, 'Sala 3');
    escribir(descripcion, 'Con camilla');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(api.crear).toHaveBeenCalledWith({ nombre: 'Sala 3', descripcion: 'Con camilla' });
    expect(api.listar).toHaveBeenCalledTimes(2);
  });

  it('edita una sala existente', async () => {
    api.actualizar.mockResolvedValue(sala('s1', 'Sala Uno'));
    const { fixture, el } = await crear();
    const editar = Array.from(el.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Editar',
    )!;
    editar.click();
    fixture.detectChanges();
    const nombre = el.querySelector('form input') as HTMLInputElement;
    expect(nombre.value).toBe('Sala 1');
    escribir(nombre, 'Sala Uno');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    expect(api.actualizar).toHaveBeenCalledWith('s1', { nombre: 'Sala Uno', descripcion: '' });
  });

  it('muestra el límite del plan cuando la API lo rechaza', async () => {
    api.crear.mockRejectedValue(
      new HttpErrorResponse({
        status: 403,
        error: { message: 'El plan Centro permite hasta 1 sala activa' },
      }),
    );
    const { fixture, el } = await crear();
    escribir(el.querySelector('form input') as HTMLInputElement, 'Otra');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('permite hasta 1 sala activa');
  });
});

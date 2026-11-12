import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { UsuariosApi } from '../../core/api/api';
import type { Miembro } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { Usuarios } from './usuarios';

function miembro(id: string, nombre: string, rol: Miembro['rol'], activo = true): Miembro {
  return {
    id,
    rol,
    activo,
    usuario: { id: `u-${id}`, email: `${id}@centro.com`, nombre, activo: true },
  };
}

describe('Usuarios', () => {
  const api = { listar: vi.fn(), crear: vi.fn(), actualizar: vi.fn() };

  beforeEach(async () => {
    Object.values(api).forEach((f) => f.mockReset());
    api.listar.mockResolvedValue([
      miembro('yo', 'Admin Uno', 'admin'),
      miembro('ana', 'Ana Pérez', 'recepcion'),
      miembro('beto', 'Beto Baja', 'profesional', false),
    ]);
    await TestBed.configureTestingModule({
      imports: [Usuarios],
      providers: [
        { provide: UsuariosApi, useValue: api },
        { provide: AuthService, useValue: { sesion: () => ({ usuario: { id: 'u-yo' } }) } },
      ],
    }).compileComponents();
  });

  async function crear() {
    const fixture = TestBed.createComponent(Usuarios);
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  function escribir(input: HTMLInputElement, valor: string) {
    input.value = valor;
    input.dispatchEvent(new Event('input'));
  }

  it('lista los activos y oculta los dados de baja', async () => {
    const { el } = await crear();
    expect(el.textContent).toContain('Ana Pérez');
    expect(el.textContent).not.toContain('Beto Baja');
    expect(el.textContent).toContain('Ver dados de baja (1)');
  });

  it('no deja cambiarse el rol ni darse de baja a uno mismo', async () => {
    const { el } = await crear();
    const filas = Array.from(el.querySelectorAll('.lista__item'));
    const propia = filas.find((f) => f.textContent?.includes('Admin Uno'))!;
    expect(propia.querySelector('select')).toBeNull();
    expect(propia.textContent).not.toContain('Dar de baja');
  });

  it('agrega sin contraseña cuando el email ya tiene cuenta', async () => {
    api.crear.mockResolvedValue(miembro('caro', 'Caro', 'profesional'));
    const { fixture, el } = await crear();
    const form = el.querySelector('form')!;
    const [nombre, email] = Array.from(form.querySelectorAll('input'));
    escribir(nombre, 'Caro');
    escribir(email, 'caro@centro.com');
    const rol = form.querySelector('select')!;
    rol.value = 'profesional';
    rol.dispatchEvent(new Event('change'));
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.crear).toHaveBeenCalledWith({
      nombre: 'Caro',
      email: 'caro@centro.com',
      rol: 'profesional',
      password: undefined,
    });
    expect(el.textContent).toContain('Caro ya puede ingresar como Profesional');
  });

  it('no envía con contraseña corta', async () => {
    const { fixture, el } = await crear();
    const form = el.querySelector('form')!;
    const [nombre, email, password] = Array.from(form.querySelectorAll('input'));
    escribir(nombre, 'Caro');
    escribir(email, 'caro@centro.com');
    escribir(password, 'corta');
    form.dispatchEvent(new Event('submit'));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.crear).not.toHaveBeenCalled();
    expect(el.textContent).toContain('al menos 10 caracteres');
  });

  it('cambia el rol de otra persona', async () => {
    api.actualizar.mockResolvedValue(miembro('ana', 'Ana Pérez', 'admin'));
    const { fixture, el } = await crear();
    const fila = Array.from(el.querySelectorAll('.lista__item')).find((f) =>
      f.textContent?.includes('Ana Pérez'),
    )!;
    const select = fila.querySelector('select')!;
    select.value = 'admin';
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(api.actualizar).toHaveBeenCalledWith('ana', { rol: 'admin' });
  });

  it('muestra el error del servidor y recarga', async () => {
    api.actualizar.mockRejectedValue(
      new HttpErrorResponse({ status: 403, error: { message: 'No podés cambiar tu propio rol' } }),
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, el } = await crear();
    const fila = Array.from(el.querySelectorAll('.lista__item')).find((f) =>
      f.textContent?.includes('Ana Pérez'),
    )!;
    (fila.querySelector('button.enlace') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(api.actualizar).toHaveBeenCalledWith('ana', { activo: false });
    expect(api.listar).toHaveBeenCalledTimes(2);
    expect(el.textContent).toContain('No podés cambiar tu propio rol');
  });
});

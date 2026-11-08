import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { Login } from './login';

describe('Login', () => {
  const login = vi.fn();

  beforeEach(async () => {
    login.mockReset();
    await TestBed.configureTestingModule({
      imports: [Login],
      providers: [provideRouter([]), { provide: AuthService, useValue: { login } }],
    }).compileComponents();
  });

  function completar(el: HTMLElement, email: string, password: string) {
    const [inEmail, inPass] = Array.from(el.querySelectorAll('input'));
    inEmail.value = email;
    inEmail.dispatchEvent(new Event('input'));
    inPass.value = password;
    inPass.dispatchEvent(new Event('input'));
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
  }

  it('no envía si el formulario es inválido', async () => {
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    completar(fixture.nativeElement, 'no-es-email', '');
    await fixture.whenStable();
    expect(login).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Ingresá un email válido');
  });

  it('entra y va al inicio', async () => {
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    login.mockResolvedValue({ centro: { id: 'c1' }, centros: [{ id: 'c1' }] });
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    completar(fixture.nativeElement, 'ana@centro.com', 'clave');
    await fixture.whenStable();
    expect(login).toHaveBeenCalledWith('ana@centro.com', 'clave');
    expect(navegar).toHaveBeenCalledWith('/');
  });

  it('con varios centros va a elegir centro', async () => {
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    login.mockResolvedValue({ centro: null, centros: [{ id: 'c1' }, { id: 'c2' }] });
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    completar(fixture.nativeElement, 'ana@centro.com', 'clave');
    await fixture.whenStable();
    expect(navegar).toHaveBeenCalledWith('/elegir-centro');
  });

  it('muestra el error de credenciales', async () => {
    login.mockRejectedValue(new HttpErrorResponse({ status: 401 }));
    const fixture = TestBed.createComponent(Login);
    await fixture.whenStable();
    completar(fixture.nativeElement, 'ana@centro.com', 'mala');
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role=alert]')?.textContent).toContain(
      'Email o contraseña incorrectos',
    );
  });
});

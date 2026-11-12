import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { RespuestaSesion } from './auth.models';
import { authInterceptor } from './auth.interceptor';
import { AuthService } from './auth.service';
import { MARCA_SESION, TokenStorage } from './token-storage';

const respuesta = (n: number, extra: Partial<RespuestaSesion> = {}): RespuestaSesion => ({
  accessToken: `access-${n}`,
  accessTokenExpiraEn: new Date().toISOString(),
  usuario: { id: 'u1', email: 'a@b.com', nombre: 'Ana', esSuperadmin: false },
  centro: { id: 'c1', nombre: 'Centro', slug: 'centro' },
  rol: 'admin',
  centros: [{ id: 'c1', nombre: 'Centro', slug: 'centro', rol: 'admin' }],
  ...extra,
});

describe('AuthService + authInterceptor', () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let guardado: string | null;

  beforeEach(() => {
    guardado = null;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        {
          provide: TokenStorage,
          useValue: {
            leer: () => guardado,
            guardar: () => (guardado = MARCA_SESION),
            recuerda: () => true,
            borrar: () => (guardado = null),
          },
        },
      ],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  async function loguear() {
    const p = auth.login('a@b.com', 'clave');
    http.expectOne('/api/v1/auth/login').flush(respuesta(1));
    await p;
  }

  it('login pide la cookie de sesión y guarda solo la marca', async () => {
    const p = auth.login('a@b.com', 'clave');
    const req = http.expectOne('/api/v1/auth/login');
    expect(req.request.headers.get('X-Sesion')).toBe('cookie');
    expect(req.request.body).toEqual({ email: 'a@b.com', password: 'clave', recordar: true });
    req.flush(respuesta(1));
    await p;
    expect(auth.autenticado()).toBe(true);
    expect(auth.sesion()?.centro?.slug).toBe('centro');
    expect(auth.token()).toBe('access-1');
    expect(guardado).toBe(MARCA_SESION);
  });

  it('guarda si atiende (admin que también es profesional)', async () => {
    const p = auth.login('a@b.com', 'clave');
    http.expectOne('/api/v1/auth/login').flush(respuesta(1, { atiende: true }));
    await p;
    expect(auth.sesion()?.atiende).toBe(true);
  });

  it('pide elegir centro si tiene varios y entró sin centro', async () => {
    const p = auth.login('a@b.com', 'clave');
    http.expectOne('/api/v1/auth/login').flush(
      respuesta(1, {
        centro: null,
        rol: null,
        centros: [
          { id: 'c1', nombre: 'A', slug: 'a', rol: 'admin' },
          { id: 'c2', nombre: 'B', slug: 'b', rol: 'recepcion' },
        ],
      }),
    );
    await p;
    expect(auth.debeElegirCentro()).toBe(true);
  });

  it('agrega el token a los pedidos a la API, pero no a otros dominios', async () => {
    await loguear();
    const cliente = TestBed.inject(HttpClient);
    cliente.get('/api/v1/usuarios').subscribe();
    cliente.get('https://otro.com/x').subscribe();
    expect(http.expectOne('/api/v1/usuarios').request.headers.get('Authorization')).toBe(
      'Bearer access-1',
    );
    expect(http.expectOne('https://otro.com/x').request.headers.has('Authorization')).toBe(false);
  });

  it('ante un 401 renueva una sola vez y reintenta los pedidos', async () => {
    await loguear();
    const cliente = TestBed.inject(HttpClient);
    const r1 = firstValueFrom(cliente.get('/api/v1/a'));
    const r2 = firstValueFrom(cliente.get('/api/v1/b'));
    http.expectOne('/api/v1/a').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/v1/b').flush(null, { status: 401, statusText: 'Unauthorized' });

    const refresh = http.expectOne('/api/v1/auth/refresh');
    expect(refresh.request.body).toEqual({ recordar: true });
    expect(refresh.request.headers.get('X-Sesion')).toBe('cookie');
    refresh.flush(respuesta(2));

    const a = http.expectOne('/api/v1/a');
    const b = http.expectOne('/api/v1/b');
    expect(a.request.headers.get('Authorization')).toBe('Bearer access-2');
    a.flush({ ok: 'a' });
    b.flush({ ok: 'b' });
    expect(await r1).toEqual({ ok: 'a' });
    expect(await r2).toEqual({ ok: 'b' });
    expect(guardado).toBe(MARCA_SESION);
  });

  it('si la renovación falla, cierra la sesión y va al login', async () => {
    await loguear();
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const pedido = firstValueFrom(TestBed.inject(HttpClient).get('/api/v1/a'));
    http.expectOne('/api/v1/a').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/v1/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    await expect(pedido).rejects.toBeTruthy();
    expect(auth.autenticado()).toBe(false);
    expect(guardado).toBeNull();
    expect(navegar).toHaveBeenCalledWith(['/login']);
  });

  it('un refresh token de la versión anterior se manda una vez para pasarlo a cookie', async () => {
    guardado = 'token-viejo';
    const p = auth.restaurar();
    const req = http.expectOne('/api/v1/auth/refresh');
    expect(req.request.body).toEqual({ refreshToken: 'token-viejo', recordar: true });
    req.flush(respuesta(1));
    expect(await p).toBe(true);
    expect(guardado).toBe(MARCA_SESION);
  });

  it('restaurar sin sesión guardada no llama a la API', async () => {
    expect(await auth.restaurar()).toBe(false);
  });

  it('logout borra la sesión local y avisa al servidor', async () => {
    await loguear();
    const p = auth.logout();
    expect(auth.autenticado()).toBe(false);
    http.expectOne('/api/v1/auth/logout').flush(null, { status: 204, statusText: 'No Content' });
    await p;
    expect(guardado).toBeNull();
  });
});

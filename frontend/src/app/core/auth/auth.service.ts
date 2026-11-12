import { HttpClient, HttpHeaders } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { catchError, finalize, firstValueFrom, map, Observable, of, shareReplay, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { DatosSesion, RespuestaSesion } from './auth.models';
import { MARCA_SESION, TokenStorage } from './token-storage';

const API = `${environment.apiUrl}/auth`;
/** Pide a la API el refresh token en una cookie httpOnly en vez de en el cuerpo. */
const WEB = { headers: new HttpHeaders({ 'X-Sesion': 'cookie' }) };

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(TokenStorage);

  private readonly _sesion = signal<DatosSesion | null>(null);
  private accessToken: string | null = null;
  private refreshEnCurso: Observable<boolean> | null = null;

  /** Datos de la sesión actual, o null si no hay sesión. */
  readonly sesion = this._sesion.asReadonly();
  readonly autenticado = computed(() => this._sesion() !== null);
  /** Tiene centros pero todavía no eligió uno. */
  readonly debeElegirCentro = computed(() => {
    const s = this._sesion();
    return !!s && !s.centro && s.centros.length > 0;
  });

  token(): string | null {
    return this.accessToken;
  }

  async login(email: string, password: string, centroId?: string): Promise<DatosSesion> {
    const r = await firstValueFrom(
      this.http.post<RespuestaSesion>(
        `${API}/login`,
        { email, password, centroId, recordar: this.storage.recuerda() },
        WEB,
      ),
    );
    return this.aplicar(r);
  }

  async cambiarCentro(centroId: string): Promise<DatosSesion> {
    const r = await firstValueFrom(
      this.http.post<RespuestaSesion>(
        `${API}/centro`,
        { centroId, recordar: this.storage.recuerda() },
        WEB,
      ),
    );
    return this.aplicar(r);
  }

  async logout(): Promise<void> {
    const viejo = this.tokenViejo();
    this.limpiar();
    // Siempre: la API borra la cookie aunque acá no quede marca de la sesión.
    await firstValueFrom(
      this.http
        .post(`${API}/logout`, viejo ? { refreshToken: viejo } : {}, WEB)
        .pipe(catchError(() => of(null))),
    );
  }

  /**
   * Renueva el access token con la cookie de sesión. Si varios pedidos lo
   * necesitan a la vez, comparten una sola renovación.
   */
  refrescar(): Observable<boolean> {
    if (!this.storage.leer()) return of(false);
    const viejo = this.tokenViejo();
    this.refreshEnCurso ??= this.http
      .post<RespuestaSesion>(
        `${API}/refresh`,
        { ...(viejo ? { refreshToken: viejo } : {}), recordar: this.storage.recuerda() },
        WEB,
      )
      .pipe(
        tap((r) => this.aplicar(r)),
        map(() => true),
        catchError(() => {
          this.limpiar();
          return of(false);
        }),
        finalize(() => (this.refreshEnCurso = null)),
        shareReplay(1),
      );
    return this.refreshEnCurso;
  }

  /** Al abrir la app: recupera la sesión si quedó una abierta. */
  restaurar(): Promise<boolean> {
    return firstValueFrom(this.refrescar());
  }

  /** Cierra la sesión local (sin avisar al servidor). */
  limpiar(): void {
    this.accessToken = null;
    this.storage.borrar();
    this._sesion.set(null);
  }

  /** Refresh token guardado por una versión anterior de la web: se pasa a cookie. */
  private tokenViejo(): string | null {
    const v = this.storage.leer();
    return v && v !== MARCA_SESION ? v : null;
  }

  private aplicar(r: RespuestaSesion): DatosSesion {
    this.accessToken = r.accessToken;
    this.storage.guardar();
    const datos: DatosSesion = {
      usuario: r.usuario,
      centro: r.centro,
      rol: r.rol,
      atiende: r.atiende ?? false,
      centros: r.centros,
    };
    this._sesion.set(datos);
    return datos;
  }
}

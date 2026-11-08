import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthService } from './auth.service';

/** Rutas de auth que no llevan token ni disparan renovación. */
const SIN_TOKEN = ['/auth/login', '/auth/refresh', '/auth/logout'].map(
  (r) => `${environment.apiUrl}${r}`,
);

function conToken(req: HttpRequest<unknown>, token: string | null) {
  return token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
}

/**
 * Agrega el access token a los pedidos a la API. Si la API responde 401
 * (token vencido), renueva la sesión una vez y reintenta; si no se puede,
 * manda al login.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl) || SIN_TOKEN.includes(req.url)) {
    return next(req);
  }
  const auth = inject(AuthService);
  const router = inject(Router);

  return next(conToken(req, auth.token())).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);
      return auth.refrescar().pipe(
        switchMap((ok) => {
          if (ok) return next(conToken(req, auth.token()));
          void router.navigate(['/login']);
          return throwError(() => err);
        }),
      );
    }),
  );
};

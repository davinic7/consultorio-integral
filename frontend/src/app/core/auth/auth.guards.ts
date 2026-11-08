import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';

/** Exige sesión; si tiene varios centros y no eligió, lo manda a elegir. */
export const autenticadoGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (!auth.autenticado()) return router.createUrlTree(['/login']);
  if (auth.debeElegirCentro()) return router.createUrlTree(['/elegir-centro']);
  return true;
};

/** Para la pantalla de elegir centro: exige sesión, pero no centro. */
export const conSesionGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.autenticado() || inject(Router).createUrlTree(['/login']);
};

/** Para el login: si ya hay sesión, va al inicio. */
export const invitadoGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return !auth.autenticado() || inject(Router).createUrlTree(['/']);
};

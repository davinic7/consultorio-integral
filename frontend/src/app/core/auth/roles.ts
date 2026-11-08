import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { Rol } from './auth.models';
import { AuthService } from './auth.service';

export const NOMBRE_ROL: Record<Rol, string> = {
  admin: 'Administración',
  recepcion: 'Recepción',
  profesional: 'Profesional',
};

/** Deja pasar solo a los roles indicados en el centro actual. */
export function rolGuard(...roles: Rol[]): CanActivateFn {
  return () => {
    const rol = inject(AuthService).sesion()?.rol;
    return (rol && roles.includes(rol)) || inject(Router).createUrlTree(['/']);
  };
}

/** ¿El rol actual puede hacer esto? Para mostrar u ocultar botones. */
export function puede(rol: Rol | null | undefined, ...roles: Rol[]): boolean {
  return !!rol && roles.includes(rol);
}

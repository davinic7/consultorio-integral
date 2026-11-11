import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import type { DatosSesion, Modulo } from './auth.models';
import { AuthService } from './auth.service';

export const NOMBRE_MODULO: Record<Modulo, string> = {
  agenda: 'Agenda',
  asistencia: 'Asistencia',
  pacientes: 'Pacientes',
  cobros: 'Cobros',
  liquidacion: 'Liquidación',
  reportes: 'Reportes',
  obras_sociales: 'Obras sociales',
  facturacion_arca: 'Facturación electrónica',
};
export const MODULOS = Object.keys(NOMBRE_MODULO) as Modulo[];

/**
 * ¿El plan del centro de la sesión incluye el módulo? Si la sesión es de una
 * versión anterior y no trae módulos, se asume que sí (la API controla igual).
 */
export function tieneModulo(sesion: DatosSesion | null | undefined, modulo: Modulo): boolean {
  const modulos = sesion?.centro?.modulos;
  return !modulos || modulos.includes(modulo);
}

/** Deja pasar solo si el plan del centro incluye el módulo. */
export function moduloGuard(modulo: Modulo): CanActivateFn {
  return () =>
    tieneModulo(inject(AuthService).sesion(), modulo) || inject(Router).createUrlTree(['/']);
}

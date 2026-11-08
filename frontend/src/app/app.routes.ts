import { Routes } from '@angular/router';
import { autenticadoGuard, conSesionGuard, invitadoGuard } from './core/auth/auth.guards';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [invitadoGuard],
    title: 'Ingresar · Centro Integral',
    loadComponent: () => import('./paginas/login/login').then((m) => m.Login),
  },
  {
    path: 'elegir-centro',
    canActivate: [conSesionGuard],
    title: 'Elegir centro · Centro Integral',
    loadComponent: () =>
      import('./paginas/elegir-centro/elegir-centro').then((m) => m.ElegirCentro),
  },
  {
    path: '',
    pathMatch: 'full',
    canActivate: [autenticadoGuard],
    title: 'Centro Integral',
    loadComponent: () => import('./paginas/inicio/inicio').then((m) => m.Inicio),
  },
  { path: '**', redirectTo: '' },
];

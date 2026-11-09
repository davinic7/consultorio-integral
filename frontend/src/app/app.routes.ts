import { Routes } from '@angular/router';
import { autenticadoGuard, conSesionGuard, invitadoGuard } from './core/auth/auth.guards';
import { rolGuard } from './core/auth/roles';

const conCentro = rolGuard('admin', 'recepcion', 'profesional');

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
    canActivate: [autenticadoGuard],
    loadComponent: () => import('./paginas/shell/shell').then((m) => m.Shell),
    children: [
      {
        path: '',
        pathMatch: 'full',
        title: 'Centro Integral',
        loadComponent: () => import('./paginas/inicio/inicio').then((m) => m.Inicio),
      },
      {
        path: 'agenda',
        canActivate: [conCentro],
        title: 'Agenda · Centro Integral',
        loadComponent: () => import('./paginas/agenda/agenda').then((m) => m.Agenda),
      },
      {
        path: 'avisos',
        canActivate: [rolGuard('admin', 'recepcion')],
        title: 'Avisos · Centro Integral',
        loadComponent: () => import('./paginas/avisos/avisos').then((m) => m.Avisos),
      },
      {
        path: 'pacientes',
        canActivate: [conCentro],
        title: 'Pacientes · Centro Integral',
        loadComponent: () => import('./paginas/pacientes/pacientes').then((m) => m.Pacientes),
      },
      {
        path: 'pacientes/nuevo',
        canActivate: [rolGuard('admin', 'recepcion')],
        title: 'Nuevo paciente · Centro Integral',
        loadComponent: () =>
          import('./paginas/paciente-ficha/paciente-ficha').then((m) => m.PacienteFicha),
      },
      {
        path: 'pacientes/:id/planilla',
        canActivate: [conCentro],
        title: 'Planilla de asistencia · Centro Integral',
        loadComponent: () => import('./paginas/planilla/planilla').then((m) => m.Planilla),
      },
      {
        path: 'pacientes/:id',
        canActivate: [conCentro],
        title: 'Paciente · Centro Integral',
        loadComponent: () =>
          import('./paginas/paciente-ficha/paciente-ficha').then((m) => m.PacienteFicha),
      },
      {
        path: 'profesionales',
        canActivate: [conCentro],
        title: 'Profesionales · Centro Integral',
        loadComponent: () =>
          import('./paginas/profesionales/profesionales').then((m) => m.Profesionales),
      },
      {
        path: 'salas',
        canActivate: [conCentro],
        title: 'Salas · Centro Integral',
        loadComponent: () => import('./paginas/salas/salas').then((m) => m.Salas),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];

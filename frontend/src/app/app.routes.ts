import { Routes } from '@angular/router';
import {
  autenticadoGuard,
  conSesionGuard,
  invitadoGuard,
  superadminGuard,
} from './core/auth/auth.guards';
import { moduloGuard } from './core/auth/modulos';
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
        path: 'asistencia',
        canActivate: [conCentro],
        title: 'Asistencia · Centro Integral',
        loadComponent: () => import('./paginas/asistencia/asistencia').then((m) => m.Asistencia),
      },
      {
        path: 'cobros',
        canActivate: [conCentro, moduloGuard('cobros')],
        title: 'Cobros y liquidación · Centro Integral',
        loadComponent: () => import('./paginas/cobros/cobros').then((m) => m.Cobros),
      },
      {
        path: 'facturacion',
        canActivate: [rolGuard('admin', 'recepcion'), moduloGuard('facturacion_arca')],
        title: 'Facturación · Centro Integral',
        loadComponent: () => import('./paginas/facturacion/facturacion').then((m) => m.Facturacion),
      },
      {
        path: 'presentacion',
        canActivate: [rolGuard('admin', 'recepcion'), moduloGuard('obras_sociales')],
        title: 'Presentación a obras sociales · Centro Integral',
        loadComponent: () => import('./paginas/presentacion/presentacion').then((m) => m.Presentacion),
      },
      {
        path: 'plataforma',
        canActivate: [superadminGuard],
        title: 'Centros y planes · Centro Integral',
        loadComponent: () => import('./paginas/plataforma/plataforma').then((m) => m.Plataforma),
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
        path: 'financiadores',
        canActivate: [conCentro],
        title: 'Obras sociales · Centro Integral',
        loadComponent: () =>
          import('./paginas/financiadores/financiadores').then((m) => m.Financiadores),
      },
      {
        path: 'usuarios',
        canActivate: [rolGuard('admin')],
        title: 'Usuarios · Centro Integral',
        loadComponent: () => import('./paginas/usuarios/usuarios').then((m) => m.Usuarios),
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

import { Component, computed, DestroyRef, effect, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { Rol } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { NOMBRE_ROL, puede } from '../../core/auth/roles';
import { AvisosService } from '../../core/avisos.service';

interface ItemMenu {
  ruta: string;
  texto: string;
  roles: Rol[];
}

const TODOS: Rol[] = ['admin', 'recepcion', 'profesional'];

const MENU: ItemMenu[] = [
  { ruta: '/agenda', texto: 'Agenda', roles: TODOS },
  { ruta: '/pacientes', texto: 'Pacientes', roles: TODOS },
  { ruta: '/profesionales', texto: 'Profesionales', roles: TODOS },
  { ruta: '/salas', texto: 'Salas', roles: TODOS },
];

/** Marco de las pantallas con sesión: barra con centro, rol, menú, avisos y salir. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
})
export class Shell {
  protected readonly auth = inject(AuthService);
  protected readonly avisos = inject(AvisosService);
  private readonly router = inject(Router);

  protected readonly rol = computed(() => {
    const rol = this.auth.sesion()?.rol;
    return rol ? NOMBRE_ROL[rol] : null;
  });
  protected readonly menu = computed(() => {
    const rol = this.auth.sesion()?.rol;
    return rol ? MENU.filter((m) => m.roles.includes(rol)) : [];
  });
  protected readonly variosCentros = computed(() => (this.auth.sesion()?.centros.length ?? 0) > 1);
  /** Admin y recepción reciben avisos de cambios de agenda. */
  protected readonly recibeAvisos = computed(() =>
    puede(this.auth.sesion()?.rol, 'admin', 'recepcion'),
  );

  constructor() {
    // Seguir el centro de la sesión: al cambiar de centro o de rol, se reinicia el contador.
    effect(() => {
      void this.auth.sesion()?.centro?.id; // dependencia del efecto
      this.avisos.detener();
      if (this.recibeAvisos()) this.avisos.iniciar();
    });
    inject(DestroyRef).onDestroy(() => this.avisos.detener());
  }

  protected async salir(): Promise<void> {
    this.avisos.detener();
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}

import { Component, computed, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import type { Rol } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { NOMBRE_ROL } from '../../core/auth/roles';

interface ItemMenu {
  ruta: string;
  texto: string;
  roles: Rol[];
}

const MENU: ItemMenu[] = [
  { ruta: '/pacientes', texto: 'Pacientes', roles: ['admin', 'recepcion', 'profesional'] },
  { ruta: '/profesionales', texto: 'Profesionales', roles: ['admin', 'recepcion', 'profesional'] },
  { ruta: '/salas', texto: 'Salas', roles: ['admin', 'recepcion', 'profesional'] },
];

/** Marco de las pantallas con sesión: barra con centro, rol, menú y salir. */
@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './shell.html',
})
export class Shell {
  protected readonly auth = inject(AuthService);
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

  protected async salir(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}

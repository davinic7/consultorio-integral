import { Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ApiHealthService } from '../../core/api-health.service';
import { AuthService } from '../../core/auth/auth.service';
import { NOMBRE_ROL } from '../../core/auth/roles';

type EstadoApi = 'cargando' | 'ok' | 'sin-base' | 'sin-api';

@Component({
  selector: 'app-inicio',
  imports: [RouterLink],
  templateUrl: './inicio.html',
})
export class Inicio {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly rol = computed(() => {
    const rol = this.auth.sesion()?.rol;
    return rol ? NOMBRE_ROL[rol] : null;
  });
  protected readonly variosCentros = computed(() => (this.auth.sesion()?.centros.length ?? 0) > 1);

  protected readonly estadoApi = toSignal(
    inject(ApiHealthService)
      .check()
      .pipe(
        map((r): EstadoApi => (r.db === 'up' ? 'ok' : 'sin-base')),
        catchError(() => of<EstadoApi>('sin-api')),
      ),
    { initialValue: 'cargando' as EstadoApi },
  );

  protected async salir(): Promise<void> {
    await this.auth.logout();
    await this.router.navigateByUrl('/login');
  }
}

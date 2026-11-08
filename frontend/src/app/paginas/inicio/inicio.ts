import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ApiHealthService } from '../../core/api-health.service';
import { AuthService } from '../../core/auth/auth.service';

type EstadoApi = 'cargando' | 'ok' | 'sin-base' | 'sin-api';

@Component({
  selector: 'app-inicio',
  imports: [RouterLink],
  templateUrl: './inicio.html',
})
export class Inicio {
  protected readonly auth = inject(AuthService);

  protected readonly estadoApi = toSignal(
    inject(ApiHealthService)
      .check()
      .pipe(
        map((r): EstadoApi => (r.db === 'up' ? 'ok' : 'sin-base')),
        catchError(() => of<EstadoApi>('sin-api')),
      ),
    { initialValue: 'cargando' as EstadoApi },
  );
}

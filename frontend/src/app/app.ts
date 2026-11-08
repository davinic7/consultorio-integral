import { Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterOutlet } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { ApiHealthService } from './core/api-health.service';

type EstadoApi = 'cargando' | 'ok' | 'sin-base' | 'sin-api';

@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  private readonly health = inject(ApiHealthService);

  protected readonly estado = toSignal(
    this.health.check().pipe(
      map((r): EstadoApi => (r.db === 'up' ? 'ok' : 'sin-base')),
      catchError(() => of<EstadoApi>('sin-api')),
    ),
    { initialValue: 'cargando' as EstadoApi },
  );
}

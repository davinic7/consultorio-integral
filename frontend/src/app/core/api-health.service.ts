import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export interface EstadoSalud {
  status: 'ok';
  db: 'up' | 'down';
}

@Injectable({ providedIn: 'root' })
export class ApiHealthService {
  private readonly http = inject(HttpClient);

  check(): Observable<EstadoSalud> {
    return this.http.get<EstadoSalud>(`${environment.apiUrl}/health`);
  }
}

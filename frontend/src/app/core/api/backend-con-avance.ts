import {
  FetchBackend,
  HttpBackend,
  HttpEvent,
  HttpRequest,
  HttpXhrBackend,
} from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import type { Observable } from 'rxjs';

/**
 * Fetch para todos los pedidos, salvo los que piden el avance de la subida (la
 * grabación del dictado): fetch no lo informa, así que esos van por XMLHttpRequest.
 * Los interceptores (token y renovación de la sesión) corren igual en los dos casos.
 */
@Injectable({ providedIn: 'root' })
export class BackendConAvance implements HttpBackend {
  private readonly fetch = inject(FetchBackend);
  private readonly xhr = inject(HttpXhrBackend);

  handle(req: HttpRequest<unknown>): Observable<HttpEvent<unknown>> {
    return req.reportUploadProgress ? this.xhr.handle(req) : this.fetch.handle(req);
  }
}

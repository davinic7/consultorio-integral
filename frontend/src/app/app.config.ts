import { HttpBackend, provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { routes } from './app.routes';
import { BackendConAvance } from './core/api/backend-con-avance';
import { authInterceptor } from './core/auth/auth.interceptor';
import { AuthService } from './core/auth/auth.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
    // Fetch, salvo las subidas que informan su avance (la grabación del dictado).
    { provide: HttpBackend, useExisting: BackendConAvance },
    // Antes de la primera pantalla, recupera la sesión si hay un refresh token guardado.
    provideAppInitializer(() => inject(AuthService).restaurar()),
  ],
};

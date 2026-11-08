import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { DatosPaciente, Miembro, Pagina, Paciente, Profesional, Sala } from './modelos';

const API = environment.apiUrl;

@Injectable({ providedIn: 'root' })
export class UsuariosApi {
  private readonly http = inject(HttpClient);

  /** Personas del centro (solo admin). */
  listar() {
    return firstValueFrom(this.http.get<Miembro[]>(`${API}/usuarios`));
  }
}

/** Arma HttpParams salteando valores vacíos. */
function params(valores: Record<string, string | number | boolean | undefined>): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(valores)) {
    if (v !== undefined && v !== '') p = p.set(k, String(v));
  }
  return p;
}

@Injectable({ providedIn: 'root' })
export class SalasApi {
  private readonly http = inject(HttpClient);

  listar(incluirInactivas = false) {
    return firstValueFrom(
      this.http.get<Sala[]>(`${API}/salas`, { params: params({ incluirInactivas }) }),
    );
  }
  crear(datos: Pick<Sala, 'nombre' | 'descripcion'>) {
    return firstValueFrom(this.http.post<Sala>(`${API}/salas`, datos));
  }
  actualizar(id: string, datos: Partial<Sala>) {
    return firstValueFrom(this.http.patch<Sala>(`${API}/salas/${id}`, datos));
  }
}

@Injectable({ providedIn: 'root' })
export class ProfesionalesApi {
  private readonly http = inject(HttpClient);

  listar(incluirInactivos = false) {
    return firstValueFrom(
      this.http.get<Profesional[]>(`${API}/profesionales`, {
        params: params({ incluirInactivos }),
      }),
    );
  }
  crear(datos: Partial<Profesional>) {
    return firstValueFrom(this.http.post<Profesional>(`${API}/profesionales`, datos));
  }
  actualizar(id: string, datos: Partial<Profesional>) {
    return firstValueFrom(this.http.patch<Profesional>(`${API}/profesionales/${id}`, datos));
  }
}

@Injectable({ providedIn: 'root' })
export class PacientesApi {
  private readonly http = inject(HttpClient);

  listar(filtro: { q?: string; pagina?: number; porPagina?: number; incluirInactivos?: boolean }) {
    return firstValueFrom(
      this.http.get<Pagina<Paciente>>(`${API}/pacientes`, { params: params(filtro) }),
    );
  }
  obtener(id: string) {
    return firstValueFrom(this.http.get<Paciente>(`${API}/pacientes/${id}`));
  }
  crear(datos: DatosPaciente) {
    return firstValueFrom(this.http.post<Paciente>(`${API}/pacientes`, datos));
  }
  actualizar(id: string, datos: DatosPaciente) {
    return firstValueFrom(this.http.patch<Paciente>(`${API}/pacientes/${id}`, datos));
  }
  asignarProfesionales(id: string, profesionalIds: string[]) {
    return firstValueFrom(
      this.http.put<void>(`${API}/pacientes/${id}/profesionales`, { profesionalIds }),
    );
  }
}

/** Mensaje para mostrar a partir de un error de la API. */
export function mensajeDeError(
  e: unknown,
  porDefecto = 'No se pudo completar la operación.',
): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'No se pudo conectar con el servidor.';
    const m = (e.error as { message?: string | string[] } | null)?.message;
    if (Array.isArray(m)) return m.join('. ');
    if (typeof m === 'string' && m) return m;
    if (e.status === 403) return 'No tenés permiso para esta acción.';
  }
  return porDefecto;
}

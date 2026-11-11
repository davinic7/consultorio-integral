import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import type { Modulo } from '../auth/auth.models';
import type {
  Aviso,
  CentroPlataforma,
  Plan,
  Conciliacion,
  DatosOrden,
  DatosPago,
  LiquidacionProfesional,
  MedioPago,
  Orden,
  Precio,
  Prestacion,
  ResumenCobros,
  CambioAsistencia,
  DatosFinanciador,
  Financiador,
  EstadoMarcable,
  HistorialAsistencia,
  Nota,
  Planilla,
  DatosPaciente,
  DatosRecurrencia,
  DatosTurno,
  Miembro,
  Ocupacion,
  Pagina,
  Paciente,
  Profesional,
  ResultadoRecurrencia,
  Sala,
  Turno,
} from './modelos';

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
export class FinanciadoresApi {
  private readonly http = inject(HttpClient);

  listar(incluirInactivos = false) {
    return firstValueFrom(
      this.http.get<Financiador[]>(`${API}/financiadores`, {
        params: params({ incluirInactivos }),
      }),
    );
  }
  crear(datos: DatosFinanciador) {
    return firstValueFrom(this.http.post<Financiador>(`${API}/financiadores`, datos));
  }
  actualizar(id: string, datos: DatosFinanciador) {
    return firstValueFrom(this.http.patch<Financiador>(`${API}/financiadores/${id}`, datos));
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

@Injectable({ providedIn: 'root' })
export class TurnosApi {
  private readonly http = inject(HttpClient);

  listar(filtro: {
    desde: string;
    hasta: string;
    profesionalId?: string;
    salaId?: string;
    pacienteId?: string;
  }) {
    return firstValueFrom(this.http.get<Turno[]>(`${API}/turnos`, { params: params(filtro) }));
  }
  ocupacion(desde: string, hasta: string) {
    return firstValueFrom(
      this.http.get<Ocupacion[]>(`${API}/turnos/ocupacion`, { params: params({ desde, hasta }) }),
    );
  }
  crear(datos: DatosTurno) {
    return firstValueFrom(this.http.post<Turno>(`${API}/turnos`, datos));
  }
  mover(id: string, datos: Partial<DatosTurno>) {
    return firstValueFrom(this.http.patch<Turno>(`${API}/turnos/${id}`, datos));
  }
  cancelar(id: string, motivo?: string) {
    return firstValueFrom(
      this.http.post<Turno>(`${API}/turnos/${id}/cancelar`, { motivo: motivo || undefined }),
    );
  }
  marcarAsistencia(id: string, estado: EstadoMarcable) {
    return firstValueFrom(this.http.post<Turno>(`${API}/turnos/${id}/asistencia`, { estado }));
  }
  cambiosAsistencia(id: string) {
    return firstValueFrom(
      this.http.get<CambioAsistencia[]>(`${API}/turnos/${id}/asistencia/cambios`),
    );
  }
  crearRecurrencia(datos: DatosRecurrencia) {
    return firstValueFrom(this.http.post<ResultadoRecurrencia>(`${API}/recurrencias`, datos));
  }
  finalizarRecurrencia(id: string, desde: string) {
    return firstValueFrom(
      this.http.post<{ cancelados: number }>(`${API}/recurrencias/${id}/finalizar`, { desde }),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class AsistenciaApi {
  private readonly http = inject(HttpClient);

  historial(pacienteId: string, desde?: string, hasta?: string) {
    return firstValueFrom(
      this.http.get<HistorialAsistencia>(`${API}/pacientes/${pacienteId}/asistencia`, {
        params: params({ desde, hasta }),
      }),
    );
  }
  planilla(pacienteId: string, mes: string, profesionalId?: string) {
    return firstValueFrom(
      this.http.get<Planilla>(`${API}/pacientes/${pacienteId}/planilla`, {
        params: params({ mes, profesionalId }),
      }),
    );
  }
}

/** Notas de sesión (solo profesionales). */
@Injectable({ providedIn: 'root' })
export class NotasApi {
  private readonly http = inject(HttpClient);

  listar(pacienteId: string) {
    return firstValueFrom(this.http.get<Nota[]>(`${API}/pacientes/${pacienteId}/notas`));
  }
  crear(pacienteId: string, datos: { texto: string; compartida: boolean; turnoId?: string | null }) {
    return firstValueFrom(this.http.post<Nota>(`${API}/pacientes/${pacienteId}/notas`, datos));
  }
  editar(id: string, datos: { texto?: string; compartida?: boolean }) {
    return firstValueFrom(this.http.patch<Nota>(`${API}/notas/${id}`, datos));
  }
}

@Injectable({ providedIn: 'root' })
export class AvisosApi {
  private readonly http = inject(HttpClient);

  listar() {
    return firstValueFrom(this.http.get<{ items: Aviso[]; noLeidos: number }>(`${API}/avisos`));
  }
  noLeidos() {
    return firstValueFrom(this.http.get<{ noLeidos: number }>(`${API}/avisos/no-leidos`));
  }
  marcarLeido(id: string) {
    return firstValueFrom(this.http.post<void>(`${API}/avisos/${id}/leido`, {}));
  }
  marcarTodos() {
    return firstValueFrom(this.http.post<{ marcados: number }>(`${API}/avisos/leer-todos`, {}));
  }
}

/** Prestaciones, pagos, resumen y conciliación del mes. */
@Injectable({ providedIn: 'root' })
export class CobrosApi {
  private readonly http = inject(HttpClient);

  prestaciones(filtro: {
    mes?: string;
    pacienteId?: string;
    profesionalId?: string;
    financiadorId?: string;
    estado?: 'por_cobrar' | 'cobrada';
  }) {
    return firstValueFrom(
      this.http.get<Prestacion[]>(`${API}/prestaciones`, { params: params(filtro) }),
    );
  }
  actualizar(
    id: string,
    datos: Partial<{
      monto: number | null;
      financiadorId: string | null;
      ordenId: string | null;
      token: string | null;
      facturada: boolean;
    }>,
  ) {
    return firstValueFrom(this.http.patch<Prestacion>(`${API}/prestaciones/${id}`, datos));
  }
  facturar(ids: string[], facturada = true) {
    return firstValueFrom(
      this.http.post<{ actualizadas: number }>(`${API}/prestaciones/facturar`, { ids, facturada }),
    );
  }
  generarFaltantes(mes: string) {
    return firstValueFrom(
      this.http.post<{ creadas: number; omitidas: number }>(`${API}/prestaciones/generar`, { mes }),
    );
  }
  pagar(prestacionId: string, datos: DatosPago) {
    return firstValueFrom(
      this.http.post<Prestacion>(`${API}/prestaciones/${prestacionId}/pagos`, datos),
    );
  }
  pagarLote(prestacionIds: string[], medio: MedioPago, fecha?: string) {
    return firstValueFrom(
      this.http.post<{ pagos: number; total: number; sinSaldo: number }>(`${API}/pagos/lote`, {
        prestacionIds,
        medio,
        fecha,
      }),
    );
  }
  actualizarPago(id: string, datos: Partial<DatosPago>) {
    return firstValueFrom(this.http.patch<Prestacion>(`${API}/pagos/${id}`, datos));
  }
  borrarPago(id: string) {
    return firstValueFrom(this.http.delete<Prestacion>(`${API}/pagos/${id}`));
  }
  resumen(mes: string) {
    return firstValueFrom(
      this.http.get<ResumenCobros>(`${API}/cobros/resumen`, { params: params({ mes }) }),
    );
  }
  conciliacion(mes: string) {
    return firstValueFrom(
      this.http.get<Conciliacion>(`${API}/cobros/conciliacion`, { params: params({ mes }) }),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class LiquidacionesApi {
  private readonly http = inject(HttpClient);

  listar(mes: string) {
    return firstValueFrom(
      this.http.get<LiquidacionProfesional[]>(`${API}/liquidaciones`, { params: params({ mes }) }),
    );
  }
  generar(profesionalId: string, mes: string) {
    return firstValueFrom(
      this.http.post<LiquidacionProfesional>(`${API}/liquidaciones`, { profesionalId, mes }),
    );
  }
  pagar(id: string) {
    return firstValueFrom(
      this.http.post<LiquidacionProfesional>(`${API}/liquidaciones/${id}/pagar`, {}),
    );
  }
  reabrir(id: string) {
    return firstValueFrom(
      this.http.post<LiquidacionProfesional>(`${API}/liquidaciones/${id}/reabrir`, {}),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class OrdenesApi {
  private readonly http = inject(HttpClient);

  listar(pacienteId: string) {
    return firstValueFrom(
      this.http.get<Orden[]>(`${API}/ordenes`, { params: params({ pacienteId }) }),
    );
  }
  crear(datos: DatosOrden) {
    return firstValueFrom(this.http.post<Orden>(`${API}/ordenes`, datos));
  }
  borrar(id: string) {
    return firstValueFrom(this.http.delete<void>(`${API}/ordenes/${id}`));
  }
}

@Injectable({ providedIn: 'root' })
export class PreciosApi {
  private readonly http = inject(HttpClient);

  /** Sin paciente: los valores generales de cada cobertura. */
  listar(pacienteId?: string) {
    return firstValueFrom(
      this.http.get<Precio[]>(`${API}/precios`, { params: params({ pacienteId }) }),
    );
  }
  crear(datos: {
    financiadorId: string | null;
    pacienteId?: string | null;
    monto: number;
    vigenteDesde: string;
  }) {
    return firstValueFrom(
      this.http.post<{ id: string; recalculadas: number }>(`${API}/precios`, datos),
    );
  }
  borrar(id: string) {
    return firstValueFrom(this.http.delete<{ recalculadas: number }>(`${API}/precios/${id}`));
  }
}

/** Centros y planes de la plataforma (solo superadmin). */
@Injectable({ providedIn: 'root' })
export class PlataformaApi {
  private readonly http = inject(HttpClient);

  centros() {
    return firstValueFrom(this.http.get<CentroPlataforma[]>(`${API}/centros`));
  }
  crearCentro(datos: {
    nombre: string;
    slug: string;
    plan: string;
    admin: { email: string; nombre: string; password?: string };
  }) {
    return firstValueFrom(this.http.post<{ id: string }>(`${API}/centros`, datos));
  }
  actualizarCentro(id: string, datos: { nombre?: string; plan?: string; activo?: boolean }) {
    return firstValueFrom(this.http.patch<unknown>(`${API}/centros/${id}`, datos));
  }
  planes() {
    return firstValueFrom(this.http.get<Plan[]>(`${API}/planes`));
  }
  crearPlan(datos: { codigo: string; nombre: string; precioMensual: number; modulos: Modulo[] }) {
    return firstValueFrom(this.http.post<Plan>(`${API}/planes`, datos));
  }
  actualizarPlan(
    id: string,
    datos: Partial<{ nombre: string; precioMensual: number; modulos: Modulo[]; activo: boolean }>,
  ) {
    return firstValueFrom(this.http.patch<Plan>(`${API}/planes/${id}`, datos));
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

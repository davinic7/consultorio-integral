export type Rol = 'admin' | 'recepcion' | 'profesional';

/** Módulos que un plan puede habilitar. */
export type Modulo =
  | 'agenda'
  | 'asistencia'
  | 'pacientes'
  | 'cobros'
  | 'liquidacion'
  | 'reportes'
  | 'obras_sociales'
  | 'facturacion_arca';

export interface CentroResumen {
  id: string;
  nombre: string;
  slug: string;
  /** Zona horaria IANA del centro (ej. America/Argentina/Catamarca). */
  zonaHoraria?: string;
  /** Plan del centro (solo el centro de la sesión). */
  plan?: { codigo: string; nombre: string };
  /** Módulos que habilita el plan (solo el centro de la sesión). */
  modulos?: Modulo[];
}

export interface CentroDeUsuario extends CentroResumen {
  rol: Rol;
}

export interface UsuarioResumen {
  id: string;
  email: string;
  nombre: string;
  esSuperadmin: boolean;
}

/** Datos de la sesión que la app muestra (sin tokens). */
export interface DatosSesion {
  usuario: UsuarioResumen;
  centro: CentroResumen | null;
  rol: Rol | null;
  centros: CentroDeUsuario[];
}

/** Respuesta de login, refresh y cambio de centro. */
export interface RespuestaSesion extends DatosSesion {
  accessToken: string;
  accessTokenExpiraEn: string;
  refreshToken: string;
}

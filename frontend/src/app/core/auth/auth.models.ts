export type Rol = 'admin' | 'recepcion' | 'profesional';

export interface CentroResumen {
  id: string;
  nombre: string;
  slug: string;
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

export interface Pagina<T> {
  items: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

export interface Miembro {
  id: string;
  rol: 'admin' | 'recepcion' | 'profesional';
  activo: boolean;
  usuario: { id: string; email: string; nombre: string; activo: boolean };
}

export interface Sala {
  id: string;
  nombre: string;
  descripcion: string | null;
  activa: boolean;
}

export interface Profesional {
  id: string;
  nombre: string;
  apellido: string;
  disciplina: string;
  matricula: string | null;
  usuarioId: string | null;
  activo: boolean;
  /** Solo visible para admin y para el propio profesional. */
  porcentajeLiquidacion?: number;
}

export type ProfesionalResumen = Pick<Profesional, 'id' | 'nombre' | 'apellido' | 'disciplina'>;

export interface Paciente {
  id: string;
  nombre: string;
  apellido: string;
  dni: string | null;
  /** AAAA-MM-DD */
  fechaNacimiento: string | null;
  telefono: string | null;
  email: string | null;
  responsableNombre: string | null;
  responsableTelefono: string | null;
  financiador: { id: string; nombre: string; tipo: string } | null;
  nroAfiliado: string | null;
  tieneCud: boolean;
  /** AAAA-MM-DD */
  cudVencimiento: string | null;
  activo: boolean;
  profesionales: ProfesionalResumen[];
}

export type DatosPaciente = Partial<
  Omit<Paciente, 'id' | 'financiador' | 'profesionales'> & {
    financiadorId: string | null;
    profesionalIds: string[];
  }
>;

export type EstadoTurno =
  'pendiente' | 'presente' | 'ausente_con_aviso' | 'ausente_sin_aviso' | 'cancelado_profesional';

/** Turno de la agenda. fecha/hora en la zona horaria del centro. */
export interface Turno {
  id: string;
  /** AAAA-MM-DD */
  fecha: string;
  /** HH:MM */
  hora: string;
  horaFin: string;
  duracionMin: number;
  inicio: string;
  fin: string;
  estado: EstadoTurno;
  observaciones: string | null;
  recurrenciaId: string | null;
  paciente: { id: string; nombre: string; apellido: string };
  profesional: { id: string; nombre: string; apellido: string };
  sala: { id: string; nombre: string } | null;
}

/** Ocupación sin datos de pacientes. */
export interface Ocupacion {
  salaId: string | null;
  profesionalId: string;
  fecha: string;
  hora: string;
  horaFin: string;
}

export interface DatosTurno {
  pacienteId: string;
  profesionalId: string;
  salaId: string | null;
  fecha: string;
  hora: string;
  duracionMin: number;
  observaciones?: string | null;
}

export interface DatosRecurrencia {
  pacienteId: string;
  profesionalId: string;
  salaId: string | null;
  diaSemana: number;
  hora: string;
  duracionMin: number;
  fechaDesde: string;
  fechaHasta?: string;
  observaciones?: string | null;
}

export interface ResultadoRecurrencia {
  recurrenciaId: string;
  creados: Turno[];
  conflictos: { fecha: string; motivo: string }[];
}

export interface Aviso {
  id: string;
  tipo: 'turno_creado' | 'turno_movido' | 'turno_cancelado';
  mensaje: string;
  turnoId: string | null;
  creadoEn: string;
  leidoEn: string | null;
  autor: { id: string; nombre: string } | null;
}

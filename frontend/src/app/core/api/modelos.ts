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

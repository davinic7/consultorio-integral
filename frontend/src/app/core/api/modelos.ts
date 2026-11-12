import type { Modulo } from '../auth/auth.models';

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

/** Alta de una persona en el centro. */
export interface DatosMiembro {
  email: string;
  nombre: string;
  rol: Miembro['rol'];
  /** Obligatoria si el email todavía no tiene cuenta; se ignora si ya existe. */
  password?: string;
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

export type TipoFinanciador = 'particular' | 'obra_social' | 'prepaga' | 'cud';

/** Obra social, prepaga o CUD con sus reglas. */
export interface Financiador {
  id: string;
  nombre: string;
  tipo: TipoFinanciador;
  activo: boolean;
  codigoPrestacion: string | null;
  requiereOrden: boolean;
  requiereToken: boolean;
  maxSesionesSemana: number | null;
  diasValidezOrden: number | null;
  observaciones: string | null;
}

export type DatosFinanciador = Partial<Omit<Financiador, 'id'>>;

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
  financiador: {
    id: string;
    nombre: string;
    tipo: TipoFinanciador;
    maxSesionesSemana: number | null;
    requiereOrden: boolean;
    requiereToken: boolean;
  } | null;
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
  profesional: { id: string; nombre: string; apellido: string; disciplina: string };
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

/** Estados que se marcan a mano desde la agenda. */
export type EstadoMarcable = Exclude<EstadoTurno, 'cancelado_profesional'>;

export interface CambioAsistencia {
  estadoAnterior: EstadoTurno;
  estadoNuevo: EstadoTurno;
  usuario: { id: string; nombre: string } | null;
  fecha: string;
}

export interface TurnoDeHistorial {
  id: string;
  fecha: string;
  hora: string;
  horaFin: string;
  estado: EstadoTurno;
  profesional: { id: string; nombre: string; apellido: string; disciplina: string };
  sala: { id: string; nombre: string } | null;
  observaciones: string | null;
}

export interface HistorialAsistencia {
  desde: string;
  hasta: string;
  resumen: Record<EstadoTurno, number> & { porcentajeAsistencia: number | null };
  turnos: TurnoDeHistorial[];
}

export interface Planilla {
  mes: string;
  centro: string;
  paciente: {
    id: string;
    nombre: string;
    apellido: string;
    dni: string | null;
    financiador: { id: string; nombre: string; tipo: string } | null;
    nroAfiliado: string | null;
    tieneCud: boolean;
  };
  profesionales: { id: string; nombre: string; apellido: string; disciplina: string }[];
  filas: {
    turnoId: string;
    fecha: string;
    hora: string;
    horaFin: string;
    profesional: { id: string; nombre: string; apellido: string; disciplina: string };
    estado: EstadoTurno;
  }[];
}

/** Nota de sesión (el texto llega ya descifrado). */
export interface Nota {
  id: string;
  texto: string;
  compartida: boolean;
  /** La escribí yo. */
  propia: boolean;
  profesional: { id: string; nombre: string; apellido: string; disciplina: string };
  turno: { id: string; inicio: string } | null;
  creadaEn: string;
  actualizadaEn: string;
}

// ───────── Cobros y liquidación ─────────

export type MedioPago = 'efectivo' | 'transferencia' | 'tarjeta' | 'otro';
export type EstadoPago = 'pendiente' | 'cobrado' | 'rechazado';
export type EstadoCobro = 'pendiente' | 'parcial' | 'cobrada' | 'rechazada';
export type AvisoPrestacion =
  | 'sin_precio'
  | 'falta_orden'
  | 'orden_vencida'
  | 'falta_token'
  | 'sin_facturar'
  | 'facturada_sin_cobrar'
  | 'rechazada'
  | 'impaga';

export interface Pago {
  id: string;
  monto: number;
  /** AAAA-MM-DD */
  fecha: string;
  medio: MedioPago;
  estado: EstadoPago;
  observaciones: string | null;
}

/** Sesión asistida que se cobra (una por turno presente). */
export interface Prestacion {
  id: string;
  turnoId: string;
  fecha: string;
  hora: string;
  paciente: { id: string; nombre: string; apellido: string };
  profesional: ProfesionalResumen;
  /** null: particular. */
  financiador: {
    id: string;
    nombre: string;
    tipo: TipoFinanciador;
    requiereOrden: boolean;
    requiereToken: boolean;
  } | null;
  monto: number;
  montoManual: boolean;
  facturada: boolean;
  token: string | null;
  /** Fecha que se declara a la obra social. */
  fechaDeclarada: string | null;
  /** Factura electrónica que la incluye. */
  facturaId: string | null;
  orden: { id: string; numero: string; fechaEmision: string; vence: string | null } | null;
  cobrado: number;
  saldo: number;
  estadoCobro: EstadoCobro;
  pagos: Pago[];
  avisos: AvisoPrestacion[];
  /** La liquidación del mes está cerrada. */
  cerrada: boolean;
}

export interface DatosPago {
  monto?: number;
  fecha?: string;
  medio: MedioPago;
  estado?: EstadoPago;
  observaciones?: string | null;
}

export interface ResumenCobros {
  mes: string;
  sesiones: number;
  facturado: number;
  cobrado: number;
  porCobrar: number;
  porCobrarSesiones: number;
  aLiquidar: number;
  retencion: number;
  cobradoPorMedio: { medio: MedioPago; monto: number }[];
  cobradoPorDia: { fecha: string; monto: number }[];
  porProfesional: { profesional: ProfesionalResumen; sesiones: number; facturado: number }[];
}

export interface Conciliacion {
  mes: string;
  porProfesional: {
    profesional: ProfesionalResumen;
    presentes: number;
    prestaciones: number;
    facturadas: number;
    cobradas: number;
    facturado: number;
    cobrado: number;
  }[];
  conteo: Partial<Record<AvisoPrestacion | 'sin_prestacion', number>>;
  sinPrestacion: {
    turnoId: string;
    fecha: string;
    hora: string;
    paciente: { id: string; nombre: string; apellido: string };
    profesional: ProfesionalResumen;
  }[];
  diferencias: Prestacion[];
}

export type EstadoLiquidacion = 'borrador' | 'cerrada' | 'pagada';

export interface LiquidacionProfesional {
  profesional: ProfesionalResumen;
  sesiones: number;
  facturado: number;
  cobrado: number;
  porcentaje: number;
  retencionPorcentaje: number;
  aLiquidar: number;
  retencion: number;
  liquidacion: {
    id: string;
    estado: EstadoLiquidacion;
    cerradaEn: string | null;
    pagadaEn: string | null;
  } | null;
  /** Turnos del mes sin asistencia marcada. */
  sinMarcar: number;
  sinPrestacion: number;
}

/** Orden de autorización de una obra social. */
export interface Orden {
  id: string;
  pacienteId: string;
  financiador: { id: string; nombre: string };
  numero: string;
  fechaEmision: string;
  vence: string | null;
  sesiones: number;
  usadas: number;
  disponibles: number;
  fechasUsadas: string[];
  vigente: boolean;
  observaciones: string | null;
}

export interface DatosOrden {
  pacienteId: string;
  financiadorId: string;
  numero: string;
  fechaEmision: string;
  vence?: string | null;
  sesiones: number;
  observaciones?: string | null;
}

/** Valor de la sesión desde una fecha. */
export interface Precio {
  id: string;
  /** null: particular. */
  financiador: { id: string; nombre: string } | null;
  pacienteId: string | null;
  monto: number;
  vigenteDesde: string;
  vigente: boolean;
  futuro: boolean;
}

// ───────── Plataforma (superadmin) ─────────

export interface Plan {
  id: string;
  codigo: string;
  nombre: string;
  precioMensual: number;
  activo: boolean;
  modulos: Modulo[];
  /** Centros que lo usan. */
  centros: number;
}

export interface CentroPlataforma {
  id: string;
  nombre: string;
  slug: string;
  activo: boolean;
  creadoEn: string;
  plan: { codigo: string; nombre: string };
  _count: { miembros: number };
}

// ───────── Facturación ARCA ─────────

export type ModoArca = 'simulado' | 'homologacion' | 'produccion';

export interface ConfigFiscal {
  /** null: datos del centro. */
  profesionalId: string | null;
  /** El centro eligió que cada profesional facture con su propio CUIT. */
  facturaCadaProfesional: boolean;
  cuit: string | null;
  razonSocial: string | null;
  domicilio: string | null;
  inicioActividades: string | null;
  ptoVta: number;
  modo: ModoArca;
  textoItem: string;
  tieneClave: boolean;
  tieneCertificado: boolean;
  certificadoVence: string | null;
}

// ───────── Reportes ─────────

interface ConteoTurnos {
  turnos: number;
  presentes: number;
  ausentesConAviso: number;
  ausentesSinAviso: number;
  cancelados: number;
  pendientes: number;
  /** % de presentes sobre los turnos que tenían que ocurrir; null sin datos. */
  asistencia: number | null;
}

export interface Reporte {
  desde: string;
  hasta: string;
  /** Es el reporte de un profesional: solo lo suyo. */
  soloProfesional: boolean;
  total: ConteoTurnos & {
    facturado: number;
    cobrado: number;
    pacientes: number;
    /** null para un profesional. */
    pacientesNuevos: number | null;
  };
  meses: (ConteoTurnos & { mes: string; pacientes: number; facturado: number; cobrado: number })[];
  porProfesional: (ConteoTurnos & {
    profesional: ProfesionalResumen;
    facturado: number;
    cobrado: number;
  })[];
  porCobertura: {
    financiador: { id: string; nombre: string } | null;
    sesiones: number;
    facturado: number;
  }[];
}

/** Profesional y el estado de sus datos fiscales (si factura cada uno). */
export interface EmisorProfesional {
  profesional: ProfesionalResumen;
  cuit: string | null;
  modo: ModoArca;
  tieneCertificado: boolean;
}

export interface PendienteFactura {
  paciente: { id: string; nombre: string; apellido: string; dni: string | null };
  sesiones: number;
  prestacionIds: string[];
  items: { cantidad: number; precio: number }[];
  total: number;
  impagas: number;
  sinDni: boolean;
}

export interface Factura {
  id: string;
  paciente: { id: string; nombre: string; apellido: string; telefono: string | null };
  /** Emisor, si factura cada profesional. */
  profesional: { id: string; nombre: string; apellido: string } | null;
  numero: number | null;
  ptoVta: number;
  fecha: string;
  total: number;
  sesiones: number;
  cae: string | null;
  caeVence: string | null;
  modo: ModoArca;
  estado: 'emitida' | 'rechazada';
  error: string | null;
  enviada: boolean;
}

// ───────── Presentación a obras sociales ─────────

export interface SesionPresentacion {
  prestacionId: string;
  fecha: string;
  fechaDeclarada: string | null;
  fechaSugerida: string | null;
  aviso: string | null;
  orden: { id: string; numero: string } | null;
  token: string | null;
  presentada: boolean;
}

export interface Presentacion {
  mes: string;
  financiador: {
    id: string;
    nombre: string;
    codigoPrestacion: string | null;
    requiereOrden: boolean;
    requiereToken: boolean;
    maxSesionesSemana: number | null;
  };
  resumen: { sesiones: number; conOrden: number; conToken: number; presentadas: number };
  pacientes: {
    paciente: { id: string; nombre: string; apellido: string; dni: string | null; nroAfiliado: string | null };
    sesiones: SesionPresentacion[];
  }[];
}

export interface ResultadoToken {
  token: string;
  pacienteId: string | null;
  paciente: string | null;
  por: 'manual' | 'afiliado' | 'dni' | null;
  prestacionId: string | null;
  fecha: string | null;
  estado: 'ok' | 'duplicado' | 'sin_paciente' | 'sin_sesion' | 'invalido';
}

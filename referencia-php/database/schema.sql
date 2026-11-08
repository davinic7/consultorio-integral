-- Esquema MySQL/MariaDB (el instalador lo adapta solo a SQLite para pruebas)

-- Cada profesional (cuenta) del sistema. clave_datos: clave propia para cifrar sus notas, cifrada con la app_key.
CREATE TABLE profesionales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  activo TINYINT NOT NULL DEFAULT 1,
  clave_datos TEXT NOT NULL,
  creado DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- es_admin = 1: administra las cuentas (no ve datos de pacientes). Los demás pertenecen a un profesional.
CREATE TABLE usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  profesional_id INT NULL,
  es_admin TINYINT NOT NULL DEFAULT 0,
  usuario VARCHAR(50) NOT NULL UNIQUE,
  nombre VARCHAR(120) NOT NULL,
  pass_hash VARCHAR(255) NOT NULL,
  creado DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE pacientes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  profesional_id INT NOT NULL,
  apellido VARCHAR(80) NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  dni VARCHAR(15) NULL,
  domicilio VARCHAR(200) NULL,
  ciudad VARCHAR(80) NULL,
  telefono VARCHAR(30) NULL,
  tel_emergencia VARCHAR(80) NULL,
  email VARCHAR(120) NULL,
  fecha_nac DATE NULL,
  estado_civil VARCHAR(30) NULL,
  ocupacion VARCHAR(80) NULL,
  cobertura VARCHAR(20) NOT NULL DEFAULT 'particular', -- particular | osep
  nro_afiliado VARCHAR(40) NULL,
  usa_token TINYINT NOT NULL DEFAULT 1,               -- OSEP: 0 = mayores sin token (planilla en papel)
  precio_sesion DECIMAL(12,2) NOT NULL DEFAULT 0,
  motivo_consulta TEXT NULL,
  ciclo_vital VARCHAR(80) NULL,
  activo TINYINT NOT NULL DEFAULT 1,
  fecha_alta DATE NOT NULL,
  fecha_baja DATE NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX ix_pacientes_prof ON pacientes (profesional_id);
CREATE INDEX ix_pac_apellido ON pacientes (apellido, nombre);

-- Historial de precios por paciente (para aumentos graduales)
CREATE TABLE precios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  profesional_id INT NOT NULL,
  paciente_id INT NOT NULL,
  precio DECIMAL(12,2) NOT NULL,
  vigente_desde DATE NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX ix_precios_prof ON precios (profesional_id);

-- Turno fijo semanal (dia_semana: 1=lunes ... 7=domingo)
CREATE TABLE turnos_fijos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  profesional_id INT NOT NULL,
  paciente_id INT NOT NULL,
  dia_semana TINYINT NOT NULL,
  hora VARCHAR(5) NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX ix_turnos_fijos_prof ON turnos_fijos (profesional_id);

CREATE TABLE ordenes_osep (
  id INT AUTO_INCREMENT PRIMARY KEY,
  profesional_id INT NOT NULL,
  paciente_id INT NOT NULL,
  nro_autorizacion VARCHAR(40) NOT NULL,
  fecha_compra DATE NOT NULL,
  fecha_vencimiento DATE NULL,             -- la orden vale un mes desde la compra
  codigo_practica VARCHAR(20) NULL,        -- ej. 01-330202-00 (psicoterapia individual)
  cantidad INT NOT NULL DEFAULT 8,
  mes VARCHAR(7) NOT NULL,                 -- YYYY-MM de las prácticas
  foto VARCHAR(255) NULL,
  observaciones VARCHAR(255) NULL,
  planilla_presentada TINYINT NOT NULL DEFAULT 0,
  creado DATETIME NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX ix_ordenes_osep_prof ON ordenes_osep (profesional_id);

-- estado: programada | asistio | ausente_aviso (avisó con +24 h, no cobra)
--         | ausente_tarde (avisó tarde o no avisó, cobra) | cancelada (la cancela la profesional)
CREATE TABLE sesiones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  profesional_id INT NOT NULL,
  paciente_id INT NOT NULL,
  fecha DATE NOT NULL,
  hora VARCHAR(5) NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'programada',
  precio DECIMAL(12,2) NOT NULL DEFAULT 0,
  pagado TINYINT NOT NULL DEFAULT 0,
  medio_pago VARCHAR(15) NULL,              -- efectivo | transferencia
  factura_id INT NULL,
  orden_id INT NULL,
  token VARCHAR(20) NULL,
  fecha_osep DATE NULL,                     -- fecha declarada en el SIA
  cargada_osep TINYINT NOT NULL DEFAULT 0,
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX ix_sesiones_prof ON sesiones (profesional_id);
CREATE INDEX ix_ses_fecha ON sesiones (fecha);
CREATE INDEX ix_ses_pac ON sesiones (paciente_id, fecha);

CREATE TABLE facturas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  profesional_id INT NOT NULL,
  paciente_id INT NOT NULL,
  periodo VARCHAR(7) NOT NULL,              -- YYYY-MM de las sesiones
  fecha DATE NOT NULL,
  pto_vta INT NOT NULL,
  cbte_tipo INT NOT NULL DEFAULT 11,
  numero INT NULL,
  cantidad INT NOT NULL,
  detalle TEXT NOT NULL,                    -- JSON con los ítems
  total DECIMAL(12,2) NOT NULL,
  cae VARCHAR(20) NULL,
  cae_vto DATE NULL,
  modo VARCHAR(12) NOT NULL,                -- produccion | homologacion | simulado
  estado VARCHAR(12) NOT NULL DEFAULT 'emitida', -- emitida | rechazada
  error TEXT NULL,
  pdf VARCHAR(255) NULL,
  enviada TINYINT NOT NULL DEFAULT 0,
  creado DATETIME NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX ix_facturas_prof ON facturas (profesional_id);

-- Notas clínicas cifradas (AES-256-GCM). tipo: sesion | historia
CREATE TABLE notas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  profesional_id INT NOT NULL,
  paciente_id INT NOT NULL,
  sesion_id INT NULL,
  fecha DATE NOT NULL,
  tipo VARCHAR(10) NOT NULL DEFAULT 'sesion',
  contenido TEXT NOT NULL,
  creado DATETIME NOT NULL,
  FOREIGN KEY (paciente_id) REFERENCES pacientes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE INDEX ix_notas_prof ON notas (profesional_id);

-- profesional_id = 0: ajustes generales del sistema (proveedor)
CREATE TABLE ajustes (
  profesional_id INT NOT NULL DEFAULT 0,
  clave VARCHAR(60) NOT NULL,
  valor TEXT NULL,
  PRIMARY KEY (profesional_id, clave)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

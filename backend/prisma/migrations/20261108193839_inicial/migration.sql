-- CreateEnum
CREATE TYPE "modulo" AS ENUM ('agenda', 'asistencia', 'pacientes', 'cobros', 'liquidacion', 'reportes', 'obras_sociales', 'facturacion_arca');

-- CreateEnum
CREATE TYPE "rol" AS ENUM ('admin', 'recepcion', 'profesional');

-- CreateEnum
CREATE TYPE "tipo_financiador" AS ENUM ('particular', 'obra_social', 'prepaga', 'cud');

-- CreateEnum
CREATE TYPE "estado_asistencia" AS ENUM ('pendiente', 'presente', 'ausente_con_aviso', 'ausente_sin_aviso', 'cancelado_profesional');

-- CreateEnum
CREATE TYPE "medio_pago" AS ENUM ('efectivo', 'transferencia', 'tarjeta', 'otro');

-- CreateEnum
CREATE TYPE "estado_pago" AS ENUM ('pendiente', 'cobrado', 'rechazado');

-- CreateEnum
CREATE TYPE "estado_liquidacion" AS ENUM ('borrador', 'cerrada', 'pagada');

-- CreateTable
CREATE TABLE "planes" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(30) NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "precio_mensual" DECIMAL(12,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "planes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_modulos" (
    "plan_id" UUID NOT NULL,
    "modulo" "modulo" NOT NULL,

    CONSTRAINT "plan_modulos_pkey" PRIMARY KEY ("plan_id","modulo")
);

-- CreateTable
CREATE TABLE "centros" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "plan_id" UUID NOT NULL,
    "zona_horaria" VARCHAR(60) NOT NULL DEFAULT 'America/Argentina/Catamarca',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "centros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" UUID NOT NULL,
    "email" VARCHAR(160) NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "es_superadmin" BOOLEAN NOT NULL DEFAULT false,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "miembros" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "rol" "rol" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "miembros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profesionales" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "usuario_id" UUID,
    "nombre" VARCHAR(80) NOT NULL,
    "apellido" VARCHAR(80) NOT NULL,
    "disciplina" VARCHAR(80) NOT NULL,
    "matricula" VARCHAR(40),
    "porcentaje_liquidacion" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "profesionales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salas" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "descripcion" VARCHAR(255),
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "salas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financiadores" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "nombre" VARCHAR(120) NOT NULL,
    "tipo" "tipo_financiador" NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "financiadores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pacientes" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "nombre" VARCHAR(80) NOT NULL,
    "apellido" VARCHAR(80) NOT NULL,
    "dni" VARCHAR(15),
    "fecha_nacimiento" DATE,
    "telefono" VARCHAR(30),
    "email" VARCHAR(160),
    "responsable_nombre" VARCHAR(120),
    "responsable_telefono" VARCHAR(30),
    "financiador_id" UUID,
    "nro_afiliado" VARCHAR(40),
    "tiene_cud" BOOLEAN NOT NULL DEFAULT false,
    "cud_vencimiento" DATE,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pacientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "paciente_profesional" (
    "centro_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,

    CONSTRAINT "paciente_profesional_pkey" PRIMARY KEY ("centro_id","paciente_id","profesional_id")
);

-- CreateTable
CREATE TABLE "recurrencias" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "sala_id" UUID,
    "dia_semana" SMALLINT NOT NULL,
    "hora" TIME(0) NOT NULL,
    "duracion_min" SMALLINT NOT NULL,
    "fecha_desde" DATE NOT NULL,
    "fecha_hasta" DATE,

    CONSTRAINT "recurrencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "turnos" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "sala_id" UUID,
    "inicio" TIMESTAMPTZ(0) NOT NULL,
    "fin" TIMESTAMPTZ(0) NOT NULL,
    "recurrencia_id" UUID,
    "estado_asistencia" "estado_asistencia" NOT NULL DEFAULT 'pendiente',
    "observaciones" VARCHAR(500),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "turnos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prestaciones" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "turno_id" UUID NOT NULL,
    "financiador_id" UUID NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "facturada" BOOLEAN NOT NULL DEFAULT false,
    "periodo" DATE NOT NULL,

    CONSTRAINT "prestaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pagos" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "prestacion_id" UUID NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "fecha" DATE NOT NULL,
    "medio" "medio_pago" NOT NULL,
    "estado" "estado_pago" NOT NULL DEFAULT 'pendiente',

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidaciones" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "periodo" DATE NOT NULL,
    "total_bruto" DECIMAL(12,2) NOT NULL,
    "porcentaje" DECIMAL(5,2) NOT NULL,
    "total_liquidado" DECIMAL(12,2) NOT NULL,
    "estado" "estado_liquidacion" NOT NULL DEFAULT 'borrador',

    CONSTRAINT "liquidaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notas_sesion" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "turno_id" UUID,
    "paciente_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "texto" TEXT NOT NULL,
    "compartida" BOOLEAN NOT NULL DEFAULT false,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notas_sesion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "planes_codigo_key" ON "planes"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "centros_slug_key" ON "centros"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE INDEX "miembros_usuario_id_idx" ON "miembros"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "miembros_centro_id_id_key" ON "miembros"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "miembros_centro_id_usuario_id_key" ON "miembros"("centro_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "profesionales_centro_id_id_key" ON "profesionales"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "profesionales_centro_id_usuario_id_key" ON "profesionales"("centro_id", "usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX "salas_centro_id_id_key" ON "salas"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "salas_centro_id_nombre_key" ON "salas"("centro_id", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "financiadores_centro_id_id_key" ON "financiadores"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "financiadores_centro_id_nombre_key" ON "financiadores"("centro_id", "nombre");

-- CreateIndex
CREATE INDEX "pacientes_centro_id_apellido_nombre_idx" ON "pacientes"("centro_id", "apellido", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_centro_id_id_key" ON "pacientes"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pacientes_centro_id_dni_key" ON "pacientes"("centro_id", "dni");

-- CreateIndex
CREATE INDEX "paciente_profesional_centro_id_profesional_id_idx" ON "paciente_profesional"("centro_id", "profesional_id");

-- CreateIndex
CREATE UNIQUE INDEX "recurrencias_centro_id_id_key" ON "recurrencias"("centro_id", "id");

-- CreateIndex
CREATE INDEX "turnos_centro_id_inicio_idx" ON "turnos"("centro_id", "inicio");

-- CreateIndex
CREATE INDEX "turnos_centro_id_profesional_id_inicio_idx" ON "turnos"("centro_id", "profesional_id", "inicio");

-- CreateIndex
CREATE INDEX "turnos_centro_id_sala_id_inicio_idx" ON "turnos"("centro_id", "sala_id", "inicio");

-- CreateIndex
CREATE INDEX "turnos_centro_id_paciente_id_inicio_idx" ON "turnos"("centro_id", "paciente_id", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "turnos_centro_id_id_key" ON "turnos"("centro_id", "id");

-- CreateIndex
CREATE INDEX "prestaciones_centro_id_periodo_idx" ON "prestaciones"("centro_id", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "prestaciones_centro_id_id_key" ON "prestaciones"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "prestaciones_centro_id_turno_id_key" ON "prestaciones"("centro_id", "turno_id");

-- CreateIndex
CREATE INDEX "pagos_centro_id_fecha_idx" ON "pagos"("centro_id", "fecha");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_centro_id_id_key" ON "pagos"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "liquidaciones_centro_id_id_key" ON "liquidaciones"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "liquidaciones_centro_id_profesional_id_periodo_key" ON "liquidaciones"("centro_id", "profesional_id", "periodo");

-- CreateIndex
CREATE INDEX "notas_sesion_centro_id_paciente_id_creada_en_idx" ON "notas_sesion"("centro_id", "paciente_id", "creada_en");

-- CreateIndex
CREATE UNIQUE INDEX "notas_sesion_centro_id_id_key" ON "notas_sesion"("centro_id", "id");

-- AddForeignKey
ALTER TABLE "plan_modulos" ADD CONSTRAINT "plan_modulos_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "planes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "centros" ADD CONSTRAINT "centros_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "planes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "miembros" ADD CONSTRAINT "miembros_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "miembros" ADD CONSTRAINT "miembros_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salas" ADD CONSTRAINT "salas_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financiadores" ADD CONSTRAINT "financiadores_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_centro_id_financiador_id_fkey" FOREIGN KEY ("centro_id", "financiador_id") REFERENCES "financiadores"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paciente_profesional" ADD CONSTRAINT "paciente_profesional_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paciente_profesional" ADD CONSTRAINT "paciente_profesional_centro_id_paciente_id_fkey" FOREIGN KEY ("centro_id", "paciente_id") REFERENCES "pacientes"("centro_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "paciente_profesional" ADD CONSTRAINT "paciente_profesional_centro_id_profesional_id_fkey" FOREIGN KEY ("centro_id", "profesional_id") REFERENCES "profesionales"("centro_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrencias" ADD CONSTRAINT "recurrencias_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrencias" ADD CONSTRAINT "recurrencias_centro_id_paciente_id_fkey" FOREIGN KEY ("centro_id", "paciente_id") REFERENCES "pacientes"("centro_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrencias" ADD CONSTRAINT "recurrencias_centro_id_profesional_id_fkey" FOREIGN KEY ("centro_id", "profesional_id") REFERENCES "profesionales"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurrencias" ADD CONSTRAINT "recurrencias_centro_id_sala_id_fkey" FOREIGN KEY ("centro_id", "sala_id") REFERENCES "salas"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_centro_id_paciente_id_fkey" FOREIGN KEY ("centro_id", "paciente_id") REFERENCES "pacientes"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_centro_id_profesional_id_fkey" FOREIGN KEY ("centro_id", "profesional_id") REFERENCES "profesionales"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_centro_id_sala_id_fkey" FOREIGN KEY ("centro_id", "sala_id") REFERENCES "salas"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_centro_id_recurrencia_id_fkey" FOREIGN KEY ("centro_id", "recurrencia_id") REFERENCES "recurrencias"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestaciones" ADD CONSTRAINT "prestaciones_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestaciones" ADD CONSTRAINT "prestaciones_centro_id_turno_id_fkey" FOREIGN KEY ("centro_id", "turno_id") REFERENCES "turnos"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestaciones" ADD CONSTRAINT "prestaciones_centro_id_financiador_id_fkey" FOREIGN KEY ("centro_id", "financiador_id") REFERENCES "financiadores"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_centro_id_prestacion_id_fkey" FOREIGN KEY ("centro_id", "prestacion_id") REFERENCES "prestaciones"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_centro_id_profesional_id_fkey" FOREIGN KEY ("centro_id", "profesional_id") REFERENCES "profesionales"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_sesion" ADD CONSTRAINT "notas_sesion_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_sesion" ADD CONSTRAINT "notas_sesion_centro_id_turno_id_fkey" FOREIGN KEY ("centro_id", "turno_id") REFERENCES "turnos"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_sesion" ADD CONSTRAINT "notas_sesion_centro_id_paciente_id_fkey" FOREIGN KEY ("centro_id", "paciente_id") REFERENCES "pacientes"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notas_sesion" ADD CONSTRAINT "notas_sesion_centro_id_profesional_id_fkey" FOREIGN KEY ("centro_id", "profesional_id") REFERENCES "profesionales"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Reglas que Prisma no expresa (agregadas a mano) ──
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_email_minusculas" CHECK ("email" = lower("email"));
ALTER TABLE "centros" ADD CONSTRAINT "centros_slug_formato" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
ALTER TABLE "planes" ADD CONSTRAINT "planes_precio_no_negativo" CHECK ("precio_mensual" >= 0);
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_porcentaje_rango" CHECK ("porcentaje_liquidacion" BETWEEN 0 AND 100);
ALTER TABLE "pacientes" ADD CONSTRAINT "pacientes_cud_vencimiento" CHECK ("tiene_cud" OR "cud_vencimiento" IS NULL);
ALTER TABLE "recurrencias" ADD CONSTRAINT "recurrencias_dia_semana_rango" CHECK ("dia_semana" BETWEEN 1 AND 7);
ALTER TABLE "recurrencias" ADD CONSTRAINT "recurrencias_duracion_positiva" CHECK ("duracion_min" > 0);
ALTER TABLE "recurrencias" ADD CONSTRAINT "recurrencias_fechas" CHECK ("fecha_hasta" IS NULL OR "fecha_hasta" >= "fecha_desde");
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_fin_despues_de_inicio" CHECK ("fin" > "inicio");
ALTER TABLE "prestaciones" ADD CONSTRAINT "prestaciones_monto_no_negativo" CHECK ("monto" >= 0);
ALTER TABLE "prestaciones" ADD CONSTRAINT "prestaciones_periodo_primer_dia" CHECK (EXTRACT(DAY FROM "periodo") = 1);
ALTER TABLE "pagos" ADD CONSTRAINT "pagos_monto_no_negativo" CHECK ("monto" >= 0);
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_periodo_primer_dia" CHECK (EXTRACT(DAY FROM "periodo") = 1);
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_porcentaje_rango" CHECK ("porcentaje" BETWEEN 0 AND 100);
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_montos_no_negativos" CHECK ("total_bruto" >= 0 AND "total_liquidado" >= 0);

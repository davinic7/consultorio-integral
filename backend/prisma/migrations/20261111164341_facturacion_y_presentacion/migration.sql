-- CreateEnum
CREATE TYPE "modo_arca" AS ENUM ('simulado', 'homologacion', 'produccion');

-- CreateEnum
CREATE TYPE "estado_factura" AS ENUM ('emitida', 'rechazada');

-- AlterTable
ALTER TABLE "prestaciones" ADD COLUMN     "factura_id" UUID,
ADD COLUMN     "fecha_declarada" DATE;

-- CreateTable
CREATE TABLE "config_fiscal" (
    "centro_id" UUID NOT NULL,
    "cuit" VARCHAR(11),
    "razon_social" VARCHAR(120),
    "domicilio" VARCHAR(200),
    "inicio_actividades" DATE,
    "pto_vta" SMALLINT NOT NULL DEFAULT 1,
    "modo" "modo_arca" NOT NULL DEFAULT 'simulado',
    "texto_item" VARCHAR(200) NOT NULL DEFAULT 'Honorarios por sesión',
    "clave_privada" TEXT,
    "certificado" TEXT,
    "certificado_vence" TIMESTAMPTZ(3),
    "ticket_token" TEXT,
    "ticket_sign" TEXT,
    "ticket_vence" TIMESTAMPTZ(3),
    "ticket_modo" "modo_arca",

    CONSTRAINT "config_fiscal_pkey" PRIMARY KEY ("centro_id")
);

-- CreateTable
CREATE TABLE "facturas" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "periodo" DATE NOT NULL,
    "fecha" DATE NOT NULL,
    "pto_vta" SMALLINT NOT NULL,
    "cbte_tipo" SMALLINT NOT NULL DEFAULT 11,
    "numero" INTEGER,
    "doc_tipo" SMALLINT NOT NULL,
    "doc_nro" VARCHAR(11) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "detalle" JSONB NOT NULL,
    "cae" VARCHAR(20),
    "cae_vence" DATE,
    "modo" "modo_arca" NOT NULL,
    "estado" "estado_factura" NOT NULL,
    "error" VARCHAR(1000),
    "enviada" BOOLEAN NOT NULL DEFAULT false,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facturas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "facturas_centro_id_periodo_idx" ON "facturas"("centro_id", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_centro_id_id_key" ON "facturas"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "facturas_centro_id_modo_pto_vta_cbte_tipo_numero_key" ON "facturas"("centro_id", "modo", "pto_vta", "cbte_tipo", "numero");

-- AddForeignKey
ALTER TABLE "prestaciones" ADD CONSTRAINT "prestaciones_centro_id_factura_id_fkey" FOREIGN KEY ("centro_id", "factura_id") REFERENCES "facturas"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "config_fiscal" ADD CONSTRAINT "config_fiscal_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_centro_id_paciente_id_fkey" FOREIGN KEY ("centro_id", "paciente_id") REFERENCES "pacientes"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

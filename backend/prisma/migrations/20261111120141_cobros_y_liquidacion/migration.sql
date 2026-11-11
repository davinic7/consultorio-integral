-- Paso 8: prestaciones, pagos, órdenes, precios y liquidaciones.
-- La tabla prestaciones estaba vacía (nada la llenaba antes de este paso),
-- así que las columnas nuevas obligatorias no necesitan valor por defecto.
-- DropIndex
DROP INDEX "prestaciones_centro_id_periodo_idx";

-- AlterTable
ALTER TABLE "liquidaciones" ADD COLUMN     "cerrada_en" TIMESTAMPTZ(3),
ADD COLUMN     "pagada_en" TIMESTAMPTZ(3),
ADD COLUMN     "sesiones" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "pagos" ADD COLUMN     "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "observaciones" VARCHAR(200);

-- AlterTable
ALTER TABLE "prestaciones" ADD COLUMN     "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "fecha" DATE NOT NULL,
ADD COLUMN     "monto_manual" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "orden_id" UUID,
ADD COLUMN     "paciente_id" UUID NOT NULL,
ADD COLUMN     "profesional_id" UUID NOT NULL,
ADD COLUMN     "token" VARCHAR(20),
ALTER COLUMN "financiador_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "ordenes" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "financiador_id" UUID NOT NULL,
    "numero" VARCHAR(40) NOT NULL,
    "fecha_emision" DATE NOT NULL,
    "vence" DATE,
    "sesiones" SMALLINT NOT NULL,
    "observaciones" VARCHAR(200),
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ordenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "precios" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "financiador_id" UUID,
    "paciente_id" UUID,
    "monto" DECIMAL(12,2) NOT NULL,
    "vigente_desde" DATE NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "precios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ordenes_centro_id_paciente_id_fecha_emision_idx" ON "ordenes"("centro_id", "paciente_id", "fecha_emision");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_centro_id_id_key" ON "ordenes"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_centro_id_financiador_id_numero_key" ON "ordenes"("centro_id", "financiador_id", "numero");

-- CreateIndex
CREATE INDEX "precios_centro_id_financiador_id_paciente_id_vigente_desde_idx" ON "precios"("centro_id", "financiador_id", "paciente_id", "vigente_desde");

-- CreateIndex
CREATE UNIQUE INDEX "precios_centro_id_id_key" ON "precios"("centro_id", "id");

-- CreateIndex
CREATE INDEX "pagos_centro_id_prestacion_id_idx" ON "pagos"("centro_id", "prestacion_id");

-- CreateIndex
CREATE INDEX "prestaciones_centro_id_periodo_profesional_id_idx" ON "prestaciones"("centro_id", "periodo", "profesional_id");

-- CreateIndex
CREATE INDEX "prestaciones_centro_id_paciente_id_fecha_idx" ON "prestaciones"("centro_id", "paciente_id", "fecha");

-- CreateIndex
CREATE INDEX "prestaciones_centro_id_orden_id_idx" ON "prestaciones"("centro_id", "orden_id");

-- AddForeignKey
ALTER TABLE "prestaciones" ADD CONSTRAINT "prestaciones_centro_id_paciente_id_fkey" FOREIGN KEY ("centro_id", "paciente_id") REFERENCES "pacientes"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestaciones" ADD CONSTRAINT "prestaciones_centro_id_profesional_id_fkey" FOREIGN KEY ("centro_id", "profesional_id") REFERENCES "profesionales"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prestaciones" ADD CONSTRAINT "prestaciones_centro_id_orden_id_fkey" FOREIGN KEY ("centro_id", "orden_id") REFERENCES "ordenes"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_centro_id_paciente_id_fkey" FOREIGN KEY ("centro_id", "paciente_id") REFERENCES "pacientes"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_centro_id_financiador_id_fkey" FOREIGN KEY ("centro_id", "financiador_id") REFERENCES "financiadores"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precios" ADD CONSTRAINT "precios_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precios" ADD CONSTRAINT "precios_centro_id_financiador_id_fkey" FOREIGN KEY ("centro_id", "financiador_id") REFERENCES "financiadores"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "precios" ADD CONSTRAINT "precios_centro_id_paciente_id_fkey" FOREIGN KEY ("centro_id", "paciente_id") REFERENCES "pacientes"("centro_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Montos y cantidades válidos en las tablas nuevas (las de prestaciones, pagos y
-- liquidaciones ya están en la migración inicial).
ALTER TABLE "precios" ADD CONSTRAINT "precios_monto_no_negativo" CHECK ("monto" >= 0);
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_sesiones_positivas" CHECK ("sesiones" > 0);
ALTER TABLE "ordenes" ADD CONSTRAINT "ordenes_vence_despues_de_emision" CHECK ("vence" IS NULL OR "vence" >= "fecha_emision");

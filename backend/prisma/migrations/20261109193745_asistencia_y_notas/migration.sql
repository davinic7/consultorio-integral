-- AlterTable
ALTER TABLE "centros" ADD COLUMN     "clave_datos" VARCHAR(200);

-- AlterTable
ALTER TABLE "notas_sesion" ADD COLUMN     "actualizada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "cambios_asistencia" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "turno_id" UUID NOT NULL,
    "estado_anterior" "estado_asistencia" NOT NULL,
    "estado_nuevo" "estado_asistencia" NOT NULL,
    "usuario_id" UUID,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cambios_asistencia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cambios_asistencia_centro_id_turno_id_creado_en_idx" ON "cambios_asistencia"("centro_id", "turno_id", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "cambios_asistencia_centro_id_id_key" ON "cambios_asistencia"("centro_id", "id");

-- AddForeignKey
ALTER TABLE "cambios_asistencia" ADD CONSTRAINT "cambios_asistencia_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cambios_asistencia" ADD CONSTRAINT "cambios_asistencia_centro_id_turno_id_fkey" FOREIGN KEY ("centro_id", "turno_id") REFERENCES "turnos"("centro_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cambios_asistencia" ADD CONSTRAINT "cambios_asistencia_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

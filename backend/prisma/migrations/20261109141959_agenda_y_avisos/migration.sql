-- CreateEnum
CREATE TYPE "tipo_aviso" AS ENUM ('turno_creado', 'turno_movido', 'turno_cancelado');

-- AlterTable
ALTER TABLE "turnos" ADD COLUMN     "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "creado_por_id" UUID;

-- CreateTable
CREATE TABLE "avisos" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "destinatario_id" UUID NOT NULL,
    "autor_id" UUID,
    "tipo" "tipo_aviso" NOT NULL,
    "mensaje" VARCHAR(400) NOT NULL,
    "turno_id" UUID,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leido_en" TIMESTAMPTZ(3),

    CONSTRAINT "avisos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avisos_centro_id_destinatario_id_leido_en_creado_en_idx" ON "avisos"("centro_id", "destinatario_id", "leido_en", "creado_en");

-- CreateIndex
CREATE UNIQUE INDEX "avisos_centro_id_id_key" ON "avisos"("centro_id", "id");

-- AddForeignKey
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_destinatario_id_fkey" FOREIGN KEY ("destinatario_id") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_autor_id_fkey" FOREIGN KEY ("autor_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "avisos" ADD CONSTRAINT "avisos_centro_id_turno_id_fkey" FOREIGN KEY ("centro_id", "turno_id") REFERENCES "turnos"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── Superposición de turnos (agregado a mano: Prisma no expresa EXCLUDE) ──
-- btree_gist permite combinar igualdad (centro, sala o profesional) con solapamiento
-- de rangos en un mismo índice. Es una extensión de confianza: la crea el dueño de la base.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Rango [inicio, fin): un turno que termina 10:00 no choca con otro que empieza 10:00.
-- Los turnos cancelados no ocupan la sala ni al profesional.
ALTER TABLE "turnos" ADD CONSTRAINT "turnos_sala_sin_superposicion"
  EXCLUDE USING gist (
    "centro_id" WITH =,
    "sala_id" WITH =,
    tstzrange("inicio", "fin", '[)') WITH &&
  ) WHERE ("sala_id" IS NOT NULL AND "estado_asistencia" <> 'cancelado_profesional');

ALTER TABLE "turnos" ADD CONSTRAINT "turnos_profesional_sin_superposicion"
  EXCLUDE USING gist (
    "centro_id" WITH =,
    "profesional_id" WITH =,
    tstzrange("inicio", "fin", '[)') WITH &&
  ) WHERE ("estado_asistencia" <> 'cancelado_profesional');

-- Expediente: cómo se escribió cada evolución, cuándo se cambió su texto, y los
-- borradores que el profesional todavía no guardó.

-- CreateEnum
CREATE TYPE "origen_nota" AS ENUM ('escrita', 'dictada');

-- AlterTable
ALTER TABLE "notas_sesion" ADD COLUMN     "editada_en" TIMESTAMPTZ(3),
ADD COLUMN     "origen" "origen_nota" NOT NULL DEFAULT 'escrita';

-- Las notas que ya existían quedan como escritas. Si se actualizaron después de
-- crearse, esa fecha pasa a ser la de su última edición: hasta ahora no se
-- distinguía un cambio de texto de un cambio de visibilidad.
UPDATE "notas_sesion"
SET "editada_en" = "actualizada_en"
WHERE "actualizada_en" > "creada_en" + INTERVAL '1 second';

-- CreateTable
CREATE TABLE "borradores_nota" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "paciente_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "turno_id" UUID,
    "texto" TEXT NOT NULL,
    "compartida" BOOLEAN NOT NULL DEFAULT false,
    "origen" "origen_nota" NOT NULL DEFAULT 'escrita',
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "borradores_nota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "borradores_nota_centro_id_id_key" ON "borradores_nota"("centro_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "borradores_nota_centro_id_paciente_id_profesional_id_key" ON "borradores_nota"("centro_id", "paciente_id", "profesional_id");

-- AddForeignKey
ALTER TABLE "borradores_nota" ADD CONSTRAINT "borradores_nota_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borradores_nota" ADD CONSTRAINT "borradores_nota_centro_id_paciente_id_fkey" FOREIGN KEY ("centro_id", "paciente_id") REFERENCES "pacientes"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "borradores_nota" ADD CONSTRAINT "borradores_nota_centro_id_profesional_id_fkey" FOREIGN KEY ("centro_id", "profesional_id") REFERENCES "profesionales"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- Un borrador nunca impide borrar su turno (por ejemplo, al borrar el centro): queda
-- sin turno. SET NULL solo de "turno_id" (PostgreSQL 15+); centro_id no se toca.
ALTER TABLE "borradores_nota" ADD CONSTRAINT "borradores_nota_centro_id_turno_id_fkey" FOREIGN KEY ("centro_id", "turno_id") REFERENCES "turnos"("centro_id", "id") ON DELETE SET NULL ("turno_id") ON UPDATE CASCADE;

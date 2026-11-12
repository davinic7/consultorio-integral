-- Regla de faltazo de cada profesional (apagada por defecto), faltazos como
-- prestaciones (tipo) que se pueden anular con motivo, y si el aviso llegó tarde.
-- Solo agrega columnas: los datos existentes quedan como estaban (sesiones).

-- CreateEnum
CREATE TYPE "modo_faltazo" AS ENUM ('completa', 'mitad', 'fijo');

-- CreateEnum
CREATE TYPE "tipo_prestacion" AS ENUM ('sesion', 'faltazo');

-- AlterTable
ALTER TABLE "prestaciones" ADD COLUMN     "anulada_en" TIMESTAMPTZ(3),
ADD COLUMN     "anulada_por_id" UUID,
ADD COLUMN     "motivo_anulacion" VARCHAR(200),
ADD COLUMN     "tipo" "tipo_prestacion" NOT NULL DEFAULT 'sesion';

-- AlterTable
ALTER TABLE "profesionales" ADD COLUMN     "faltazo_activo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "faltazo_modo" "modo_faltazo" NOT NULL DEFAULT 'completa',
ADD COLUMN     "faltazo_monto" DECIMAL(12,2),
ADD COLUMN     "faltazo_tolerancia_horas" SMALLINT NOT NULL DEFAULT 24;

-- AlterTable
ALTER TABLE "turnos" ADD COLUMN     "aviso_tarde" BOOLEAN;

-- AddForeignKey
ALTER TABLE "prestaciones" ADD CONSTRAINT "prestaciones_anulada_por_id_fkey" FOREIGN KEY ("anulada_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Con modo "fijo" el monto es obligatorio.
ALTER TABLE "profesionales" ADD CONSTRAINT "profesionales_faltazo_monto_fijo" CHECK ("faltazo_modo" <> 'fijo' OR "faltazo_monto" IS NOT NULL);

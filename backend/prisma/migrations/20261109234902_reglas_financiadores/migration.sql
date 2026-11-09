-- AlterTable
ALTER TABLE "financiadores" ADD COLUMN     "codigo_prestacion" VARCHAR(40),
ADD COLUMN     "dias_validez_orden" SMALLINT,
ADD COLUMN     "max_sesiones_semana" SMALLINT,
ADD COLUMN     "observaciones" VARCHAR(500),
ADD COLUMN     "requiere_orden" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiere_token" BOOLEAN NOT NULL DEFAULT false;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "modulo" ADD VALUE 'notas';
ALTER TYPE "modulo" ADD VALUE 'salas';
ALTER TYPE "modulo" ADD VALUE 'dictado';
ALTER TYPE "modulo" ADD VALUE 'arca_por_profesional';

-- AlterTable
ALTER TABLE "planes" ADD COLUMN     "max_profesionales" SMALLINT,
ADD COLUMN     "max_salas" SMALLINT,
ADD COLUMN     "max_usuarios" SMALLINT;

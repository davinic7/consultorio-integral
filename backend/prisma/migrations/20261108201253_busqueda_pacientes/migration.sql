-- pg_trgm permite indexar búsquedas "contiene" (ILIKE %x%). Es una extensión de confianza:
-- la puede crear el dueño de la base, sin superusuario.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- AlterTable
ALTER TABLE "pacientes" ADD COLUMN     "busqueda" VARCHAR(400) NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "pacientes_busqueda_idx" ON "pacientes" USING GIN ("busqueda" gin_trgm_ops);

-- Completa la búsqueda de los pacientes existentes (sin tildes y en minúsculas).
UPDATE "pacientes" SET "busqueda" = translate(
  lower(concat_ws(' ', "nombre", "apellido", "dni", "telefono", regexp_replace(coalesce("telefono", ''), '\D', '', 'g'))),
  'áéíóúüñàèìòù', 'aeiouunaeiou'
);

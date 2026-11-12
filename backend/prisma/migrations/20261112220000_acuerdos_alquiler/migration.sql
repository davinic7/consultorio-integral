-- Acuerdos de alquiler entre el centro y cada profesional, en lugar del
-- porcentaje fijo de liquidación. Sin perder datos:
-- 1. El porcentaje de cada profesional pasa a un acuerdo "porcentaje" con lo
--    que retenía el centro (100 - porcentaje del profesional), vigente desde
--    siempre. Así los meses abiertos dan lo mismo que antes.
-- 2. Las liquidaciones ya generadas guardan su cálculo: alquiler = lo que
--    retuvo el centro, y el saldo (total_liquidado) queda igual.

CREATE TABLE "acuerdos_alquiler" (
    "id" UUID NOT NULL,
    "centro_id" UUID NOT NULL,
    "profesional_id" UUID NOT NULL,
    "vigente_desde" DATE NOT NULL,
    "monto_fijo" DECIMAL(12,2),
    "porcentaje" DECIMAL(5,2),
    "monto_por_sesion" DECIMAL(12,2),
    "monto_por_hora" DECIMAL(12,2),
    "sesiones_equivalentes" SMALLINT,
    "cobra_el_centro" BOOLEAN NOT NULL DEFAULT true,
    "nota" VARCHAR(200),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "acuerdos_alquiler_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "acuerdos_alquiler_centro_id_id_key" ON "acuerdos_alquiler"("centro_id", "id");
CREATE UNIQUE INDEX "acuerdos_alquiler_centro_id_profesional_id_vigente_desde_key" ON "acuerdos_alquiler"("centro_id", "profesional_id", "vigente_desde");

ALTER TABLE "acuerdos_alquiler" ADD CONSTRAINT "acuerdos_alquiler_centro_id_fkey" FOREIGN KEY ("centro_id") REFERENCES "centros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "acuerdos_alquiler" ADD CONSTRAINT "acuerdos_alquiler_centro_id_profesional_id_fkey" FOREIGN KEY ("centro_id", "profesional_id") REFERENCES "profesionales"("centro_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 1. Porcentaje de cada profesional → acuerdo.
INSERT INTO "acuerdos_alquiler" ("id", "centro_id", "profesional_id", "vigente_desde", "porcentaje", "nota")
SELECT gen_random_uuid(), "centro_id", "id", DATE '2000-01-01', 100 - "porcentaje_liquidacion",
       'Pasado del porcentaje de liquidación (' || "porcentaje_liquidacion" || ' % para el profesional)'
FROM "profesionales"
WHERE "porcentaje_liquidacion" < 100;

-- 2. Liquidaciones ya generadas.
ALTER TABLE "liquidaciones"
ADD COLUMN "alquiler" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN "cobra_el_centro" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "detalle_alquiler" JSONB;

UPDATE "liquidaciones" SET
  "alquiler" = "total_bruto" - "total_liquidado",
  "detalle_alquiler" = jsonb_build_object(
    'acuerdoId', NULL,
    'vigenteDesde', NULL,
    'cobraElCentro', true,
    'componentes', jsonb_build_array(jsonb_build_object(
      'tipo', 'porcentaje',
      'valor', 100 - "porcentaje",
      'base', "total_bruto",
      'monto', "total_bruto" - "total_liquidado"
    )),
    'nota', 'Liquidación anterior a los acuerdos de alquiler'
  );

ALTER TABLE "liquidaciones" DROP COLUMN "porcentaje";
ALTER TABLE "profesionales" DROP COLUMN "porcentaje_liquidacion";

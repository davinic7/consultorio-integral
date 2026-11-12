-- Datos fiscales por emisor: el centro o cada profesional con su propio CUIT.
-- Las filas y facturas existentes quedan como emisor "centro".

-- config_fiscal: clave propia (id) en lugar de centro_id.
ALTER TABLE "config_fiscal" ADD COLUMN "id" UUID;
UPDATE "config_fiscal" SET "id" = gen_random_uuid();
ALTER TABLE "config_fiscal" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "config_fiscal" DROP CONSTRAINT "config_fiscal_pkey",
ADD COLUMN     "factura_cada_profesional" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "profesional_id" UUID,
ADD CONSTRAINT "config_fiscal_pkey" PRIMARY KEY ("id");

CREATE UNIQUE INDEX "config_fiscal_centro_id_id_key" ON "config_fiscal"("centro_id", "id");
CREATE UNIQUE INDEX "config_fiscal_centro_id_profesional_id_key" ON "config_fiscal"("centro_id", "profesional_id");
-- Una sola fila del centro (profesional_id null) por centro.
CREATE UNIQUE INDEX "config_fiscal_centro_unico" ON "config_fiscal"("centro_id") WHERE "profesional_id" IS NULL;

ALTER TABLE "config_fiscal" ADD CONSTRAINT "config_fiscal_centro_id_profesional_id_fkey" FOREIGN KEY ("centro_id", "profesional_id") REFERENCES "profesionales"("centro_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
-- La opción "cada profesional factura" solo tiene sentido en la fila del centro.
ALTER TABLE "config_fiscal" ADD CONSTRAINT "config_fiscal_opcion_solo_centro" CHECK ("profesional_id" IS NULL OR NOT "factura_cada_profesional");

-- facturas: emisor (y profesional, si factura cada uno).
ALTER TABLE "facturas" ADD COLUMN "config_fiscal_id" UUID,
ADD COLUMN     "profesional_id" UUID;

-- Centros con facturas y sin datos fiscales (no debería pasar): se les crea la fila.
INSERT INTO "config_fiscal" ("id", "centro_id")
SELECT gen_random_uuid(), f."centro_id"
FROM "facturas" f
WHERE NOT EXISTS (
  SELECT 1 FROM "config_fiscal" c WHERE c."centro_id" = f."centro_id" AND c."profesional_id" IS NULL
)
GROUP BY f."centro_id";

UPDATE "facturas" f SET "config_fiscal_id" = c."id"
FROM "config_fiscal" c
WHERE c."centro_id" = f."centro_id" AND c."profesional_id" IS NULL;

ALTER TABLE "facturas" ALTER COLUMN "config_fiscal_id" SET NOT NULL;

DROP INDEX "facturas_centro_id_modo_pto_vta_cbte_tipo_numero_key";
CREATE UNIQUE INDEX "facturas_config_fiscal_id_modo_pto_vta_cbte_tipo_numero_key" ON "facturas"("config_fiscal_id", "modo", "pto_vta", "cbte_tipo", "numero");

ALTER TABLE "facturas" ADD CONSTRAINT "facturas_centro_id_config_fiscal_id_fkey" FOREIGN KEY ("centro_id", "config_fiscal_id") REFERENCES "config_fiscal"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_centro_id_profesional_id_fkey" FOREIGN KEY ("centro_id", "profesional_id") REFERENCES "profesionales"("centro_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

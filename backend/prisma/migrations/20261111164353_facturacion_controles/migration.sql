-- Controles de la facturación (además de la validación de la API).
ALTER TABLE "config_fiscal" ADD CONSTRAINT "config_fiscal_cuit_formato" CHECK ("cuit" IS NULL OR "cuit" ~ '^[0-9]{11}$');
ALTER TABLE "config_fiscal" ADD CONSTRAINT "config_fiscal_pto_vta_rango" CHECK ("pto_vta" BETWEEN 1 AND 99998);
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_total_no_negativo" CHECK ("total" >= 0);
ALTER TABLE "facturas" ADD CONSTRAINT "facturas_emitida_con_cae" CHECK ("estado" <> 'emitida' OR ("numero" IS NOT NULL AND "cae" IS NOT NULL));

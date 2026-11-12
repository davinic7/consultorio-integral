-- Los planes que ya existen siguen haciendo lo mismo con los módulos nuevos:
-- las notas antes iban con "pacientes" y las salas con "agenda"; ARCA por
-- profesional, con "facturacion_arca". (Va aparte: un valor nuevo de un enum
-- no se puede usar en la misma migración que lo crea.)
INSERT INTO "plan_modulos" ("plan_id", "modulo")
SELECT "plan_id", 'notas'::"modulo" FROM "plan_modulos" WHERE "modulo" = 'pacientes'
ON CONFLICT DO NOTHING;

INSERT INTO "plan_modulos" ("plan_id", "modulo")
SELECT "plan_id", 'salas'::"modulo" FROM "plan_modulos" WHERE "modulo" = 'agenda'
ON CONFLICT DO NOTHING;

INSERT INTO "plan_modulos" ("plan_id", "modulo")
SELECT "plan_id", 'arca_por_profesional'::"modulo" FROM "plan_modulos" WHERE "modulo" = 'facturacion_arca'
ON CONFLICT DO NOTHING;

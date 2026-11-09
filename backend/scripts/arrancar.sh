#!/bin/sh
# Arranque en un servidor (Docker, Render, Railway…). Todo es idempotente:
# se puede ejecutar en cada reinicio sin duplicar nada.
set -e

echo "→ Migraciones de la base"
npx prisma migrate deploy

echo "→ Planes y módulos"
npx prisma db seed

# Primer superadmin (opcional). Si el email ya existe, no se cambia su contraseña.
if [ -n "$SUPERADMIN_EMAIL" ] && [ -n "$SUPERADMIN_PASSWORD" ]; then
  echo "→ Superadmin"
  npx tsx scripts/crear-superadmin.ts "$SUPERADMIN_EMAIL" "${SUPERADMIN_NOMBRE:-Superadmin}"
fi

# Datos de demostración (opcional, solo para un ambiente de prueba).
if [ "$CARGAR_DEMO" = "true" ]; then
  echo "→ Datos demo"
  npx tsx prisma/demo.ts
fi

echo "→ Iniciando la API"
exec node dist/main.js

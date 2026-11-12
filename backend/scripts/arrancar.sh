#!/bin/sh
# Arranque en un servidor (Docker, Render, Railway…). Todo es idempotente:
# se puede ejecutar en cada reinicio sin duplicar nada.
#
# Las migraciones y los planes son obligatorios: si fallan, el contenedor no arranca.
# El superadmin y los datos demo son opcionales: si fallan (por ejemplo, una contraseña
# corta), solo se avisa en el log y la API arranca igual.
set -e

echo "→ Migraciones de la base"
npx prisma migrate deploy

echo "→ Planes y módulos"
npx prisma db seed

# Corre un paso opcional; si falla, avisa y sigue.
opcional() {
  nombre="$1"
  shift
  echo "→ $nombre"
  if ! "$@"; then
    echo "⚠ $nombre falló; la API arranca igual. Revisá el error de arriba." >&2
  fi
}

# Primer superadmin (opcional). Si el email ya existe, no se cambia su contraseña.
if [ -n "$SUPERADMIN_EMAIL" ] && [ -n "$SUPERADMIN_PASSWORD" ]; then
  opcional "Superadmin" npx tsx scripts/crear-superadmin.ts "$SUPERADMIN_EMAIL" "${SUPERADMIN_NOMBRE:-Superadmin}"
fi

# Datos de demostración (opcional, solo para un ambiente de prueba).
if [ "$CARGAR_DEMO" = "true" ]; then
  opcional "Datos demo" npx tsx prisma/demo.ts
fi

echo "→ Iniciando la API"
exec node dist/main.js

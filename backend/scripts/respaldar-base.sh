#!/bin/sh
# Respaldo completo de una base de Centro Integral (por ejemplo, la de Render).
#
#   RESPALDO_DATABASE_URL='postgresql://…' sh scripts/respaldar-base.sh [carpeta]
#
# - La URL se toma de RESPALDO_DATABASE_URL y nunca se muestra (tiene la contraseña).
#   En Render: base de datos → Connect → "External Database URL".
# - Deja un archivo centro-integral-AAAA-MM-DD-HHMM.dump (formato de pg_dump -Fc) en la
#   carpeta indicada, o en ~/respaldos-centro-integral. Nunca dentro del repositorio.
# - El respaldo tiene datos personales de pacientes (las notas van cifradas): guardalo
#   en un lugar seguro y no lo subas a ningún servicio sin cifrar.
# - Para leer las notas después de restaurar hace falta la misma DATOS_CLAVE_MAESTRA:
#   guardala aparte (gestor de contraseñas), no junto al respaldo.
#
# Requiere pg_dump de la misma versión mayor que la base (17). En Windows suele estar en
# "C:\Program Files\PostgreSQL\17\bin"; el script lo busca ahí si no está en el PATH.
set -eu

if [ -z "${RESPALDO_DATABASE_URL:-}" ]; then
  echo "Falta RESPALDO_DATABASE_URL (la URL externa de la base)." >&2
  exit 1
fi

PG_DUMP=$(command -v pg_dump || true)
for d in "/c/Program Files/PostgreSQL/17/bin" "/usr/lib/postgresql/17/bin"; do
  [ -z "$PG_DUMP" ] && [ -x "$d/pg_dump" ] && PG_DUMP="$d/pg_dump"
  [ -z "$PG_DUMP" ] && [ -x "$d/pg_dump.exe" ] && PG_DUMP="$d/pg_dump.exe"
done
if [ -z "$PG_DUMP" ]; then
  echo "No encuentro pg_dump (PostgreSQL 17)." >&2
  exit 1
fi

CARPETA=${1:-"$HOME/respaldos-centro-integral"}
REPO=$(cd "$(dirname "$0")/../.." && pwd)
mkdir -p "$CARPETA"
CARPETA=$(cd "$CARPETA" && pwd)
case "$CARPETA/" in
  "$REPO"/*)
    rmdir "$CARPETA" 2>/dev/null || true
    echo "La carpeta del respaldo no puede estar dentro del repositorio." >&2
    exit 1
    ;;
esac
ARCHIVO="$CARPETA/centro-integral-$(date +%Y-%m-%d-%H%M).dump"

echo "→ Respaldando en $ARCHIVO"
# Sin dueños ni permisos: así se restaura en cualquier base nueva.
"$PG_DUMP" --format=custom --no-owner --no-acl --dbname="$RESPALDO_DATABASE_URL" --file="$ARCHIVO"

echo "→ Listo: $(du -h "$ARCHIVO" | cut -f1)."
echo "  Tablas respaldadas: $("$(dirname "$PG_DUMP")/pg_restore" --list "$ARCHIVO" | grep -c ' TABLE DATA ')"

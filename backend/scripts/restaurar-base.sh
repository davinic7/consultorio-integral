#!/bin/sh
# Restaura un respaldo hecho con respaldar-base.sh en una base VACÍA (una base nueva de
# Render, por ejemplo). No borra nada: si la base ya tiene tablas, se detiene.
#
#   RESTAURAR_DATABASE_URL='postgresql://…' sh scripts/restaurar-base.sh archivo.dump
#
# Después de restaurar, el servicio tiene que usar la misma DATOS_CLAVE_MAESTRA que la
# base original; si no, las notas cifradas no se pueden leer.
set -eu

ARCHIVO=${1:-}
if [ -z "$ARCHIVO" ] || [ ! -f "$ARCHIVO" ]; then
  echo "Uso: RESTAURAR_DATABASE_URL='…' sh scripts/restaurar-base.sh archivo.dump" >&2
  exit 1
fi
if [ -z "${RESTAURAR_DATABASE_URL:-}" ]; then
  echo "Falta RESTAURAR_DATABASE_URL (la URL de la base donde restaurar)." >&2
  exit 1
fi

BIN=""
if command -v pg_restore >/dev/null; then
  BIN=$(dirname "$(command -v pg_restore)")
else
  for d in "/c/Program Files/PostgreSQL/17/bin" "/usr/lib/postgresql/17/bin"; do
    [ -z "$BIN" ] && { [ -x "$d/pg_restore" ] || [ -x "$d/pg_restore.exe" ]; } && BIN="$d"
  done
fi
if [ -z "$BIN" ]; then
  echo "No encuentro pg_restore (PostgreSQL 17)." >&2
  exit 1
fi

# Solo en una base vacía: nunca pisar datos.
TABLAS=$("$BIN/psql" "$RESTAURAR_DATABASE_URL" -tAc \
  "select count(*) from information_schema.tables where table_schema = 'public'")
if [ "$TABLAS" != "0" ]; then
  echo "La base de destino ya tiene $TABLAS tablas: restaurá en una base vacía." >&2
  exit 1
fi

echo "→ Restaurando $ARCHIVO"
"$BIN/pg_restore" --no-owner --no-acl --exit-on-error --dbname="$RESTAURAR_DATABASE_URL" "$ARCHIVO"

PACIENTES=$("$BIN/psql" "$RESTAURAR_DATABASE_URL" -tAc "select count(*) from pacientes")
CENTROS=$("$BIN/psql" "$RESTAURAR_DATABASE_URL" -tAc "select count(*) from centros")
echo "→ Listo: $CENTROS centros y $PACIENTES pacientes restaurados."

#!/bin/sh
# Arranque del servicio de transcripción (whisper.cpp server).
#
# Variables:
#   PORT                  puerto (8080 por defecto; Render lo define solo).
#   WHISPER_MODELO        modelo con el que arranca: small, large-v3-turbo…
#   WHISPER_HILOS         hilos de cálculo. Sin definir: los núcleos asignados, hasta 8.
#   WHISPER_RUTA_SECRETA  solo para la medición con dirección pública: un prefijo al
#                         azar ("/abc123…") sin el cual el servicio no atiende. En
#                         producción no hace falta: el servicio va en la red privada.
#
# El servidor no guarda el audio en disco ni escribe lo transcripto en el registro.
# Acá se registran solo números: hilos y memoria.
set -eu

MODELO="/modelos/ggml-${WHISPER_MODELO:-small}.bin"
if [ ! -f "$MODELO" ]; then
  echo "No está el modelo ${WHISPER_MODELO:-small}. La imagen trae:" >&2
  ls /modelos >&2
  exit 1
fi

# Hilos: los núcleos que el contenedor tiene asignados, no los de la máquina entera
# (con más hilos que núcleos, la transcripción se vuelve mucho más lenta).
HILOS="${WHISPER_HILOS:-}"
if [ -z "$HILOS" ]; then
  HILOS=$(nproc)
  if [ -r /sys/fs/cgroup/cpu.max ]; then
    read -r CUOTA PERIODO < /sys/fs/cgroup/cpu.max
    if [ "$CUOTA" != "max" ]; then
      ASIGNADOS=$(( (CUOTA + PERIODO - 1) / PERIODO ))
      [ "$ASIGNADOS" -lt "$HILOS" ] && HILOS=$ASIGNADOS
    fi
  fi
  [ "$HILOS" -gt 8 ] && HILOS=8
  [ "$HILOS" -lt 1 ] && HILOS=1
fi

RUTA="${WHISPER_RUTA_SECRETA:-}"
case "$RUTA" in
  "") ;;
  /*[!A-Za-z0-9_-]*)
    echo "WHISPER_RUTA_SECRETA: después de la barra, solo letras, números y guiones." >&2
    exit 1 ;;
  /?*) ;;
  *)
    echo "WHISPER_RUTA_SECRETA tiene que empezar con una barra: /abc123" >&2
    exit 1 ;;
esac

# Carpeta que el servidor publica: solo memoria.json, con números (ver más abajo).
ESTADO=/tmp/estado
mkdir -p "$ESTADO"

echo "whisper: modelo ${WHISPER_MODELO:-small}, $HILOS hilos"
set -- --host 0.0.0.0 --port "${PORT:-8080}" --model "$MODELO" --language es \
  --threads "$HILOS" --public "$ESTADO"
[ -n "$RUTA" ] && set -- "$@" --request-path "$RUTA"

whisper-server "$@" &
SERVIDOR=$!
trap 'kill "$SERVIDOR" 2>/dev/null' TERM INT

# Memoria del servidor, una vez por segundo, en /memoria.json (para el script de
# medición) y en el registro cada vez que el máximo sube 50 MB.
(
  LIMITE=0
  if [ -r /sys/fs/cgroup/memory.max ]; then
    L=$(cat /sys/fs/cgroup/memory.max)
    [ "$L" != "max" ] && LIMITE=$((L / 1024))
  fi
  AVISADO=0
  while kill -0 "$SERVIDOR" 2>/dev/null; do
    RSS=$(awk '/^VmRSS:/ {print $2}' "/proc/$SERVIDOR/status" 2>/dev/null || true)
    PICO=$(awk '/^VmHWM:/ {print $2}' "/proc/$SERVIDOR/status" 2>/dev/null || true)
    CONTENEDOR=0
    if [ -r /sys/fs/cgroup/memory.current ]; then
      CONTENEDOR=$(( $(cat /sys/fs/cgroup/memory.current) / 1024 ))
    fi
    if [ -n "$RSS" ] && [ -n "$PICO" ]; then
      printf '{"rss_kb":%s,"pico_kb":%s,"contenedor_kb":%s,"limite_kb":%s,"hilos":%s}\n' \
        "$RSS" "$PICO" "$CONTENEDOR" "$LIMITE" "$HILOS" > "$ESTADO/memoria.tmp"
      mv "$ESTADO/memoria.tmp" "$ESTADO/memoria.json"
      if [ $((PICO - AVISADO)) -ge 51200 ]; then
        AVISADO=$PICO
        echo "whisper: memoria máxima $((PICO / 1024)) MB"
      fi
    fi
    sleep 1
  done
) &

# Si el servidor se cae (por ejemplo, sin memoria), el contenedor termina con su
# código y Render lo vuelve a levantar.
CODIGO=0
wait "$SERVIDOR" || CODIGO=$?
exit "$CODIGO"

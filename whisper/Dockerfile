# Servicio de transcripción del dictado: whisper.cpp server (docs/decisiones.md §19 y §20).
# El audio llega desde la API por la red privada, se transcribe en memoria y se descarta.
#
#   docker build -t centro-whisper whisper
#   docker run -p 8080:8080 centro-whisper
#
# Para la medición trae los dos modelos candidatos. La imagen de producción lleva solo
# el elegido:  docker build --build-arg MODELOS=small -t centro-whisper whisper

# ───────── Etapa 1: compilar whisper.cpp ─────────
FROM debian:13-slim AS compilar
RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Versión fija: v1.9.5. Para actualizar, cambiar el commit y volver a medir.
ARG WHISPER_CPP_COMMIT=d1be6fde11ac6e0407606b4e42fe72d34add8037
WORKDIR /wcpp
RUN git init -q . \
  && git remote add origin https://github.com/ggml-org/whisper.cpp \
  && git fetch -q --depth 1 origin "$WHISPER_CPP_COMMIT" \
  && git checkout -q FETCH_HEAD

# GGML_NATIVE=OFF: no se optimiza para la máquina que compila (la de Render que
# construye la imagen puede no ser la que la corre); queda con AVX2, FMA y F16C.
RUN cmake -B build \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_NATIVE=OFF \
    -DWHISPER_BUILD_TESTS=OFF \
    -DWHISPER_BUILD_EXAMPLES=ON \
  && cmake --build build -j"$(nproc)" --target whisper-server

# ───────── Etapa 2: bajar los modelos ─────────
FROM debian:13-slim AS modelos
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Modelos a incluir, separados por espacios. Tienen que figurar en modelos.sha1.
ARG MODELOS="small large-v3-turbo"
WORKDIR /modelos
COPY modelos.sha1 /tmp/modelos.sha1
# Solo se bajan los pesos del modelo: en este paso no se manda ningún dato.
RUN set -eu; for m in $MODELOS; do \
    curl -fL --retry 3 -o "ggml-$m.bin" \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$m.bin"; \
    grep " ggml-$m.bin\$" /tmp/modelos.sha1 | sha1sum -c -; \
  done

# ───────── Etapa 3: ejecutar ─────────
FROM debian:13-slim
# whisper.cpp reparte el trabajo entre los núcleos con OpenMP.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 \
  && rm -rf /var/lib/apt/lists/* \
  && useradd --system --no-create-home whisper

COPY --from=compilar /wcpp/build/bin/whisper-server /usr/local/bin/whisper-server
COPY --from=modelos /modelos /modelos
COPY arrancar.sh /arrancar.sh

ENV PORT=8080 \
    WHISPER_MODELO=small
USER whisper
EXPOSE 8080
CMD ["sh", "/arrancar.sh"]

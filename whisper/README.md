# Servicio de transcripción (Whisper)

El dictado del expediente se transcribe en un servicio propio: [whisper.cpp](https://github.com/ggml-org/whisper.cpp) con un modelo abierto. El audio no va a terceros ([decisiones.md](../docs/decisiones.md) §19 y §20).

- `Dockerfile`: compila whisper.cpp (versión fija) y baja los modelos, verificando cada uno con su suma (`modelos.sha1`).
- `arrancar.sh`: elige el modelo y los hilos, arranca el servidor y publica cuánta memoria usa (`/memoria.json`, solo números).
- `medicion/`: lo necesario para elegir el modelo y el plan de Render.

El servidor recibe el audio en memoria, no lo guarda en disco y no escribe lo transcripto en el registro.

## Variables

| Variable | Para qué | Por defecto |
| --- | --- | --- |
| `PORT` | Puerto. Render lo define solo. | `8080` |
| `WHISPER_MODELO` | Modelo con el que arranca: `small` o `large-v3-turbo`. | `small` |
| `WHISPER_HILOS` | Hilos de cálculo. | Los núcleos asignados, hasta 8 |
| `WHISPER_RUTA_SECRETA` | Solo para la medición: prefijo al azar sin el cual el servicio no atiende. | Sin prefijo |

## Medición: qué modelo y qué plan

Se comparan `small` y `large-v3-turbo` con una grabación de prueba: tiempo, memoria y cuánto se equivocan con el vocabulario clínico. Con eso se elige el modelo y el plan de Render.

**Siempre con el texto de prueba inventado, nunca con el audio de una sesión real:** durante la medición el servicio tiene dirección pública y el informe muestra el texto.

### 1. Grabar el audio

1. Abrir `medicion/grabar.html` con doble clic (Chrome o Edge) y dejar a la vista `medicion/texto-para-leer.txt`.
2. Grabar leyendo el texto completo, al ritmo normal de dictado. Son unos dos minutos.
3. Descargar `mi-voz.wav` y guardarlo **fuera del repositorio**.

La página usa el mismo micrófono del navegador y la misma conversión que la app. Para medir con el micrófono del celular, hay que grabar desde ahí (abriendo el archivo en el navegador del teléfono).

### 2. Crear el servicio de prueba en Render

Lo crea el responsable del proyecto desde su cuenta; no está en `render.yaml` a propósito.

1. **New → Web Service**, con este repositorio y la rama que tenga esta carpeta.
2. **Language:** Docker. **Root Directory:** `whisper`.
3. **Instance type:** uno con memoria de sobra para el modelo grande (por ejemplo, 4 GB). La medición dice después cuánto hace falta de verdad.
4. **Environment:** `WHISPER_RUTA_SECRETA` con una barra y unos 30 caracteres al azar. Para generarlos: `node -e "console.log('/' + require('crypto').randomBytes(24).toString('base64url'))"`.
5. **Health Check Path:** `/memoria.json`.

La primera construcción tarda varios minutos (compila y baja unos 2 GB de modelos).

### 3. Medir

Desde `backend`, con la dirección del servicio más el prefijo secreto:

```bash
npm run medir-whisper -- --url https://NOMBRE.onrender.com/PREFIJO --audio RUTA/mi-voz.wav --salida RUTA/medicion.md
```

Carga cada modelo, transcribe la grabación igual que la API (partes de hasta 28 s, con el contexto de lo anterior) y muestra por modelo:

- cuánto tarda en cargar y en transcribir, y cuánto tardaría un dictado de 10 minutos;
- la parte más lenta (la API corta a los 180 s por parte);
- la memoria máxima del servidor;
- el porcentaje de palabras con error respecto del texto leído y los términos de `medicion/terminos.txt` que no reconoció;
- el texto completo de cada modelo, para compararlos a ojo.

Si un modelo no entra en la memoria del plan, el servicio se cae y el informe lo dice. Para probar otro plan, se cambia el tipo de instancia en Render y se mide de nuevo.

### 4. Al terminar

**Borrar o suspender el servicio de prueba** (se cobra por el tiempo que está encendido) y anotar el resultado en `docs/decisiones.md`.

## Producción (después de elegir)

- Servicio **privado** de Render (sin dirección pública), en la misma región que la API, con la imagen construida solo con el modelo elegido (`MODELOS` en el `Dockerfile`) y sin `WHISPER_RUTA_SECRETA`.
- En la API: `DICTADO_MOTOR=whisper` y `WHISPER_URL` con la dirección interna del servicio.

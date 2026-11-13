# Expediente con dictado — guía para implementar

La pestaña **Notas** de la ficha del paciente pasa a ser el **Expediente**: la historia clínica del paciente para cada profesional, con evoluciones escritas o dictadas. Esta guía es para quien la implemente (una persona o Claude Code). Usa el sistema [Órbita Cian](orbita-cian.md): mismas clases `oc-*`, mismos tokens y las mismas reglas.

- **Lienzo de diseño (fuente de verdad visual):** https://claude.ai/artifact/TGM2P7tYpgEbXyNj1koZNh
- **Código de referencia:** `docs/diseno/referencia/expediente/*.dc.html`, los tableros del lienzo. Como los de Órbita Cian, son HTML con estilos en línea y la lógica al final; sirven para copiar medidas, textos y comportamiento. No se abren sueltos en el navegador.
- **Decisión de fondo:** [decisiones.md](../decisiones.md) §19. La transcripción corre en nuestro servidor con Whisper; no se usa el reconocimiento de voz del navegador.

| Tablero                     | Qué muestra                                                                                                                                                                                          |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Main.dc.html`              | Pestaña Expediente en escritorio, funcionando: línea de tiempo, filtros, leer, editar, privada o compartida, y el panel de nueva evolución con todo el flujo del dictado. Tiene tema oscuro y claro. |
| `DictadoEscritorio.dc.html` | Los 10 estados del dictado en el panel de escritorio (460 px).                                                                                                                                       |
| `Celular.dc.html`           | Expediente en el celular: lista, primer uso, nueva evolución, lectura y edición.                                                                                                                     |
| `DictadoA.dc.html`          | Dictado en el celular: permiso, permiso negado, listo, grabando, en pausa y cerca del límite.                                                                                                        |
| `DictadoB.dc.html`          | Dictado en el celular: transcribiendo, el expediente mientras transcribe, sin conexión, revisar, error y salir sin guardar.                                                                          |
| `Claro.dc.html`             | Muestra en tema claro.                                                                                                                                                                               |
| `Comportamiento.dc.html`    | Transiciones, giro del teléfono, pantalla bloqueada, borradores y accesibilidad.                                                                                                                     |

## Reglas propias del expediente

1. **El cian marca solo lo vivo**: la grabación en curso, la acción principal y lo seleccionado. "Dictar" y "Escribir" tienen el mismo peso y van en neutro.
2. **Grabando se ve a la distancia** y nunca depende solo del color: franja cian arriba con "GRABANDO", punto que titila, borde que brilla, tiempo grande y anillo que sigue la voz.
3. **Privacidad en los textos.** Se usa: «en forma privada», «cifrado», «solo queda el texto», «el audio no se guarda». Nunca: nombres de empresas, «nube», «IA». Ningún texto puede sugerir que el audio va a otra empresa.
4. **Indicador de cifrado discreto**: «Contenido cifrado» con un candado chico, en mono y color suave, con la explicación en el `title`.
5. **Celular primero.** Lo que se toca seguido va en el tercio inferior. Mínimo 48 px por botón; "Terminar" mide 88 px y queda al centro, entre Descartar y Pausar.

## Vistas

### 1. Línea de tiempo (`Main`, `Celular` 1 y 1 B)

- Evoluciones de la más nueva a la más vieja, agrupadas por mes (`NOVIEMBRE 2026`).
- Cada evolución muestra: fecha y hora de la sesión (mono), el turno vinculado o «Sin turno», el autor («Vos · …» o el profesional), **Privada** o **Compartida** y **Dictada** o **Escrita**, siempre con ícono y texto.
- Las de otros profesionales tienen tinte ámbar, punto hueco y la marca «Del equipo · solo lectura». Solo se editan las propias.
- Resumen de 3 líneas; «Leer completa» abre el texto en el lugar, con los títulos de la guía en mayúsculas chicas y el cuerpo a 15 px con interlineado 1,75.
- Búsqueda por texto y filtros de período (7 días, 30 días, Este año, Todo) y de autor (Todas, Mías, Del equipo). El texto está cifrado en la base, así que se filtra después de descifrar, en el navegador.
- **Primer uso:** ilustración de órbita con micrófono, «Todavía no hay evoluciones de …» y dos botones del mismo peso: «Dictar la primera» y «Escribir la primera».
- En el celular, abajo y fijos, «Dictar» y «Escribir» con el turno de hoy encima.

### 2. Nueva evolución (`Main`, panel derecho; `Celular` 2)

- **Sesión:** por defecto, el turno de hoy con ese paciente; si no, la elige de sus sesiones recientes o marca «Sin turno: llamada, reunión o informe».
- **Dos caminos del mismo peso:** Dictar («Hablás y queda en texto») y Escribir («Con el teclado, a tu ritmo»).
- **Guía de estructura, opcional y plegable:** Motivo, Desarrollo de la sesión, Observaciones y Plan. Se suman como títulos al borrador; se pueden borrar. Se recuerda por profesional.
- Debajo, en chico: «Si dictás, el audio no se guarda: se convierte en texto en forma privada y se borra. Queda solo el texto, cifrado.»

### 3. Dictado: estados (`DictadoEscritorio`, `DictadoA`, `DictadoB`)

| Estado                   | Qué se ve                                                                                                                                                            | Acciones                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 3.1 Permiso, primera vez | «Antes de dictar» y tres frases: tu voz se convierte en texto en forma privada; el audio no se guarda; te queda un borrador para revisar.                            | Permitir el micrófono · Prefiero escribir                  |
| 3.1 b Permiso negado     | «El micrófono está bloqueado» con los pasos para habilitarlo (navegador y app instalada).                                                                            | Probar de nuevo · Escribir la evolución                    |
| 3.2 Listo                | Botón de micrófono grande (168 px en celular), la guía elegida y «Hasta 10:00 por tramo».                                                                            | Tocá para empezar · Mejor la escribo                       |
| 3.3 Grabando             | Franja «GRABANDO», tiempo grande, anillo de progreso hacia 10:00, ondas y barras que siguen el nivel de voz.                                                         | Descartar · Terminar · Pausar · Achicar                    |
| 3.3 b En pausa           | Franja neutra «EN PAUSA», anillo quieto, «El micrófono está apagado hasta que reanudes».                                                                             | Descartar · Terminar · Reanudar                            |
| 3.3 c Cerca del límite   | Desde 9:00, el anillo pasa a ámbar y un aviso explica que a las 10:00 el tramo termina solo.                                                                         | Las mismas                                                 |
| 3.4 Transcribiendo       | Progreso real: segundos de audio procesados sobre el total, y los pasos (grabación guardada, convirtiendo, borrador listo).                                          | Seguir en el expediente                                    |
| 3.4 b Mientras tanto     | En la línea de tiempo, una tarjeta punteada «Borrador en camino» con el porcentaje, y una barra flotante abajo. En escritorio, la píldora de la barra superior.      | Ver                                                        |
| 3.5 Sin conexión         | «No hay señal»: la grabación quedó guardada en el dispositivo, cifrada, y se transcribe sola al volver la conexión. Lista «En espera» con paciente, hora y duración. | Volver al expediente · Escribir mientras tanto             |
| 3.6 Revisar              | Borrador editable a 16 px, aviso de revisar los términos clínicos, «Para revisar» con las palabras dudosas, otro tramo que se suma al final y quién la ve.           | Dictar otro tramo · Privada o Equipo · Guardar evolución   |
| 3.7 Error                | «No se pudo transcribir», la grabación sigue en el dispositivo, intento y código (`TR-02`).                                                                          | Reintentar · Escribir en su lugar · Descartar la grabación |
| 3.8 Salir sin guardar    | Hoja de abajo (celular) o diálogo (escritorio). La opción segura es la principal.                                                                                    | Seguir editando · Descartar el borrador                    |

Mientras graba o transcribe, en escritorio la barra superior muestra una píldora («GRABANDO · 02:47», «TRANSCRIBIENDO · 62 %», «BORRADOR SIN GUARDAR») que lleva de vuelta al paciente.

### 4. Leer y editar (`Main`, `Celular` 4 y 4 B)

- Lectura cómoda de texto largo y, abajo, «Quién la ve» con Privada o Compartida y quién la ve («La ves solo vos» o «La ven vos y Lic. …»).
- Editar solo las propias. Muestra la fecha de la última edición del **texto**: cambiar la visibilidad no cuenta como edición.
- En el celular, «Dictar y sumar al final» dentro de la edición.

## Comportamiento

- **Transiciones:** el botón se abre en anillo al empezar (200 ms); el mismo anillo se vuelve el progreso al transcribir; la evolución guardada entra arriba con un fundido de 250 ms. Vibración corta al empezar y al terminar, si el teléfono la tiene.
- **Girar el teléfono:** la grabación no se corta. Horizontal: anillo y tiempo a la izquierda, controles en columna a la derecha.
- **Pantalla bloqueada:** mientras graba se pide mantener la pantalla encendida (Wake Lock). Si igual se bloquea o se cambia de app, lo grabado queda como tramo y al volver se ofrece Reanudar o Terminar. Nunca se graba escondido.
- **Escritorio angosto:** menos de 900 px, el panel pasa debajo de la lista; menos de 600 px, se abre a pantalla completa como en el celular.
- **Movimiento reducido:** sin ondas ni titileo; el estado se sigue leyendo por texto, ícono y tiempo.
- **Accesibilidad:** se anuncian «Grabando», «En pausa», «Transcripción lista» y los errores, sin leer el tiempo cada segundo. Foco de 3 px (`#67E8F9` en oscuro, `#0E7490` en claro). En escritorio, con el foco en el panel: Espacio pausa o reanuda, Enter termina y Esc pide confirmar la salida.

## Datos y permisos

- **Quién:** solo quien escribe notas (profesional, o admin que también atiende) y atiende al paciente, con los módulos `notas` y `dictado` del plan. Recepción y administración nunca reciben audio ni texto clínico. La API es la que bloquea (`@Roles` y `@RequiereModulo`).
- **Notas:** cada evolución guarda si fue escrita o dictada y cuándo se editó su texto. Una migración nueva lo agrega; las notas que ya existen quedan como escritas.
- **Audio:** el navegador lo manda como WAV PCM de 16 bits, mono, a 16 kHz. El servidor lo procesa en memoria, nunca en disco, y lo descarta al terminar. Ni el audio ni el texto van a los registros: solo ids, duraciones y códigos.
- **Límites:** 10 minutos por tramo, tamaño máximo de subida acorde y un límite de dictados por minuto por usuario. Los valores están en [decisiones.md](../decisiones.md) §20.
- **Sin señal:** la grabación espera en el dispositivo cifrada con la clave pública de la persona, que solo el servidor puede abrir, y se borra apenas se transcribe bien ([decisiones.md](../decisiones.md) §20).

## Cómo quedó hecho (paso 3)

- **Frontend:** `core/dictado/` (grabación, WAV de 16 kHz, cifrado con WebCrypto, cola en IndexedDB y el servicio global `DictadoService`), `paginas/paciente-ficha/dictado-panel.*` (los estados del dictado) y `paginas/shell/pildora-dictado.ts` (la píldora de la barra superior, también en el celular). El dictado sigue aunque se cambie de pantalla; la píldora lleva de vuelta a `/pacientes/:id?pestana=expediente`.
- **Backend:** `src/dictado/` (claves, paquete cifrado, WAV, cola de trabajos y motores) y `NotasService.sumarAlBorrador`. El texto va directo al borrador del servidor: la consulta del trabajo nunca devuelve texto.
- **Para desarrollar:** sin `DICTADO_MOTOR`, el motor simulado devuelve «Texto de prueba del dictado: N segundos de audio.» después de 0,7 s. Hoy solo el plan Individual Full trae el módulo `dictado`; para probarlo en Centro Demo hay que sumárselo al plan desde la pantalla de planes del superadmin.
- **Diferencias con el lienzo, para más adelante:**
  - No hay botón «Achicar» al grabar: se puede ir a otra pantalla y la grabación sigue, con la píldora para volver.
  - Mientras transcribe no está la tarjeta punteada «Borrador en camino» en la línea de tiempo ni la barra flotante del celular: el avance se ve en la píldora.
  - Faltan los atajos de teclado del panel (Espacio, Enter, Esc) y la disposición horizontal del teléfono girado (la grabación no se corta, pero se ve en columna).
  - En la lista «En espera», una grabación que falló 3 veces en el servidor queda con «ERROR» y no se puede reintentar ni descartar desde ahí: solo se borra al cerrar sesión.

## Orden de implementación

Cada paso en su propio commit, con `npm test` y `npm run test:e2e` en `backend`, y `npx ng test --watch=false` y `npx ng build` en `frontend`.

1. Esta guía y los tableros de referencia (hecho).
2. **Expediente sin dictado:** migración (origen y fecha de edición), sesiones para vincular, y la pestaña nueva en lugar de `notas-paciente.ts` (hecho).
3. **Grabación en el navegador y API del dictado** con un motor simulado para desarrollar: todos los estados, la cola sin señal y los límites. Suma su caso a `aislamiento-centros.e2e-spec.ts` (hecho).
4. **Whisper de verdad** (falta): el servicio propio, la medición de memoria y tiempo para elegir el plan de Render, y la decisión del modelo en `decisiones.md`. Preparado: la imagen del servicio y la medición, en [whisper/README.md](../../whisper/README.md).

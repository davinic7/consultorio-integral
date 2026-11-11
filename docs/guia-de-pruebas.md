# Guía de pruebas — Centro Integral

Versión 1.0: los 10 pasos del prototipo, con el rediseño Órbita Cian. Login y roles por centro, ABM de salas, profesionales y pacientes, agenda con avisos, asistencia, planilla mensual, notas de sesión cifradas, obras sociales con sus reglas, cobros, conciliación y liquidación, planes con módulos, facturación electrónica con ARCA y presentación a obras sociales.

**Probar sin instalar nada:** la versión publicada está en https://centro-integral.onrender.com (mismos usuarios demo; la contraseña es la de `DEMO_PASSWORD` que se cargó en Render). Si nadie la usó en los últimos 15 minutos, la primera visita tarda cerca de un minuto en abrir.

---

## 1. Levantar el sistema

Requisitos: Node 26 o superior (trae `Temporal`, que usa la agenda) y PostgreSQL 17 corriendo (servicio de Windows `postgresql-x64-17`).

**Desde el Code tab de Claude:** los servidores ya están en `.claude/launch.json` (`backend` y `frontend`).

**Desde una terminal**, uno en cada ventana:

```bash
cd backend && npm run start:dev
```

```bash
cd frontend && npm start
```

| Qué | URL |
| --- | --- |
| App web | http://localhost:4200 |
| API | http://localhost:3000/api/v1 |
| Documentación de la API (Swagger) | http://localhost:3000/api/docs |
| Contrato OpenAPI (JSON) | http://localhost:3000/api/openapi.json |
| Salud de la API y la base | http://localhost:3000/api/v1/health |

**Base vacía o recién clonada:**

```bash
cd backend && npm install && npm run db:migrate && npm run db:seed && npm run db:demo
```

---

## 2. Usuarios demo

Todos usan la misma contraseña: el valor de `DEMO_PASSWORD` en `backend/.env` (ese archivo no está en git).

| Usuario | Centro Demo | Centro Demo Norte |
| --- | --- | --- |
| `superadmin@demo.local` | — (superadmin de la plataforma) | — |
| `admin@demo.local` | Administración | — |
| `recepcion@demo.local` | Recepción | — |
| `profesional@demo.local` | Profesional | Recepción |

Datos ya cargados en Centro Demo durante las pruebas: la sala "Sala 1", el profesional "Pérez, Pablo" (vinculado a `profesional@demo.local`) y la paciente "Gómez, Juana" (con CUD, asignada a Pérez).

Para volver a crear los usuarios demo (no borra nada): `cd backend && npm run db:demo`.

---

## 3. Mapa del código

### Backend (`backend/`)

| Qué querés ver | Archivo |
| --- | --- |
| Modelo de datos completo (tablas, relaciones, `centro_id`) | [prisma/schema.prisma](../backend/prisma/schema.prisma) |
| SQL real de la base, con los CHECK | [prisma/migrations/](../backend/prisma/migrations) |
| **Aislamiento entre centros** (equivale a `q()` + `pf()` de la referencia PHP) | [src/prisma/centro.ts](../backend/src/prisma/centro.ts) |
| Arranque de la app: prefijo `/api/v1`, CORS, Swagger y validación | [src/setup-app.ts](../backend/src/setup-app.ts) |
| Variables de entorno validadas | [src/config/env.ts](../backend/src/config/env.ts) |
| Login, refresh rotativo, cambio de centro | [src/auth/auth.service.ts](../backend/src/auth/auth.service.ts) |
| Guard global: token, `@Roles`, `@SoloSuperadmin` | [src/auth/auth.guard.ts](../backend/src/auth/auth.guard.ts) |
| Hash de contraseñas (scrypt) | [src/auth/password.ts](../backend/src/auth/password.ts) |
| Usuarios del centro (admin) | [src/usuarios/](../backend/src/usuarios) |
| Alta de centros (superadmin) | [src/centros/centros.service.ts](../backend/src/centros/centros.service.ts) |
| **Planes y módulos**: `@RequiereModulo`, caché, endpoints del superadmin | [src/planes/planes.ts](../backend/src/planes/planes.ts) |
| **Cliente ARCA** (WSAA, WSFEv1, firma CMS, QR) | [src/facturacion/arca.ts](../backend/src/facturacion/arca.ts) |
| Facturación: datos fiscales, emisión, PDF | [src/facturacion/facturacion.ts](../backend/src/facturacion/facturacion.ts) y [pdf.ts](../backend/src/facturacion/pdf.ts) |
| Presentación a obras sociales (fecha a declarar, tokens) | [src/cobros/presentacion.ts](../backend/src/cobros/presentacion.ts) y [presentacion-reglas.ts](../backend/src/cobros/presentacion-reglas.ts) |
| Salas | [src/salas/salas.ts](../backend/src/salas/salas.ts) |
| Profesionales (porcentaje visible según rol) | [src/profesionales/profesionales.ts](../backend/src/profesionales/profesionales.ts) |
| Pacientes: búsqueda, alcance por rol, asignación | [src/pacientes/pacientes.ts](../backend/src/pacientes/pacientes.ts) |
| Marcar asistencia, registro de cambios, mes cerrado | [src/turnos/turnos.service.ts](../backend/src/turnos/turnos.service.ts) (`marcarAsistencia`) |
| Obras sociales con sus reglas | [src/financiadores/financiadores.ts](../backend/src/financiadores/financiadores.ts) |
| **Cobros**: prestación por turno presente, pagos, conciliación | [src/cobros/prestaciones.service.ts](../backend/src/cobros/prestaciones.service.ts) y [src/cobros/cobros.service.ts](../backend/src/cobros/cobros.service.ts) |
| Reglas de cobro (estado, avisos, cálculo de la liquidación) | [src/cobros/reglas.ts](../backend/src/cobros/reglas.ts) |
| Liquidación por profesional (generar, pagar, reabrir) | [src/cobros/liquidaciones.ts](../backend/src/cobros/liquidaciones.ts) |
| Órdenes de autorización y precios con historial | [src/cobros/ordenes.ts](../backend/src/cobros/ordenes.ts) y [src/cobros/precios.ts](../backend/src/cobros/precios.ts) |
| Historial y planilla mensual | [src/asistencia/asistencia.ts](../backend/src/asistencia/asistencia.ts) |
| Notas de sesión y quién las ve | [src/notas/notas.ts](../backend/src/notas/notas.ts) |
| **Cifrado de notas** (AES-256-GCM, clave por centro) | [src/notas/cifrado.ts](../backend/src/notas/cifrado.ts) |
| Búsqueda sin tildes | [src/common/texto.ts](../backend/src/common/texto.ts) |
| Errores de base → HTTP (409, 404) | [src/common/prisma-errores.filter.ts](../backend/src/common/prisma-errores.filter.ts) |
| Planes y módulos (seed) | [prisma/seed.ts](../backend/prisma/seed.ts) |
| Datos demo | [prisma/demo.ts](../backend/prisma/demo.ts) |

### Frontend (`frontend/src/app/`)

| Qué querés ver | Archivo |
| --- | --- |
| Rutas y guards por rol | [app.routes.ts](../frontend/src/app/app.routes.ts) |
| Sesión: login, refresh, cambio de centro | [core/auth/auth.service.ts](../frontend/src/app/core/auth/auth.service.ts) |
| Renovación automática del token ante un 401 | [core/auth/auth.interceptor.ts](../frontend/src/app/core/auth/auth.interceptor.ts) |
| Llamadas a la API | [core/api/api.ts](../frontend/src/app/core/api/api.ts) |
| Menú lateral, barra superior y barra inferior del celular | [paginas/shell/](../frontend/src/app/paginas/shell) |
| Sistema de diseño Órbita Cian (colores, clases `oc-*`, tema) | [styles/_orbita.scss](../frontend/src/styles/_orbita.scss) y [docs/diseno/orbita-cian.md](diseno/orbita-cian.md) |
| Tema claro y oscuro | [core/tema.service.ts](../frontend/src/app/core/tema.service.ts) |
| Pantallas | [paginas/](../frontend/src/app/paginas) (login, elegir-centro, inicio (panel), agenda, asistencia, cobros, facturacion, presentacion, pacientes, paciente-ficha, planilla, profesionales, salas, financiadores, avisos, plataforma) |
| Estilos (modo claro y oscuro) | [styles.scss](../frontend/src/styles.scss) |

### Decisiones y alcance

- [docs/decisiones.md](decisiones.md): por qué cada elección técnica.
- [docs/prototipo.md](prototipo.md): alcance y orden de desarrollo.

---

## 4. Pruebas en vivo (app web)

Marcá cada caso a medida que lo probás. "Esperado" es lo que tiene que pasar.

### 4.1 Login y sesión

- [ ] **Contraseña incorrecta:** entrar con `admin@demo.local` y una clave cualquiera → "Email o contraseña incorrectos".
- [ ] **Email inexistente:** entrar con `nadie@demo.local` → el mismo mensaje (no revela si la cuenta existe).
- [ ] **Un solo centro:** entrar con `admin@demo.local` → va directo al inicio de Centro Demo · Administración.
- [ ] **Varios centros:** entrar con `profesional@demo.local` → pantalla "Elegí un centro" con los dos centros y el rol en cada uno.
- [ ] **Recargar la página (F5):** la sesión sigue abierta, en el mismo centro.
- [ ] **Cambiar de centro:** con `profesional@demo.local`, enlace "Cambiar de centro" → elegir el otro → la barra muestra el centro y el rol nuevos.
- [ ] **Salir:** botón Salir → vuelve al login; al entrar a http://localhost:4200/ manda al login.
- [ ] **Superadmin:** entrar con `superadmin@demo.local` → "Entraste como superadministrador" y en el menú solo Panel y "Centros y planes".
- [ ] **Mostrar contraseña:** el ícono del ojo muestra y oculta lo escrito.
- [ ] **Recordarme:** sin tildar "Recordarme en este equipo", entrar, cerrar la pestaña y abrir la app de nuevo → pide ingresar. Tildado → la sesión sigue.
- [ ] **Celular:** el formulario aparece completo sin bajar; el sello DaviNic queda debajo.

### 4.1 bis Diseño, tema y menú

- [ ] **Tema:** el botón de sol/luna (arriba a la derecha y en el login) cambia entre claro y oscuro; al recargar se mantiene. Sin elegir, sigue el tema del dispositivo.
- [ ] **Menú lateral:** logo de Centro Integral, centro y rol, y las secciones Panel, Agenda, Asistencia, Pacientes, Profesionales y Salas; la activa se ve resaltada. Abajo, la versión y el sello DaviNic (al pasar el mouse crece; al tocarlo abre WhatsApp).
- [ ] **Buscador:** escribir `gomez` y Enter (o Ctrl K para ir al buscador) → abre Pacientes con la búsqueda hecha.
- [ ] **Avisos:** la campana (solo admin y recepción) muestra el número sin leer y abre Avisos.
- [ ] **Cuenta:** el círculo con las iniciales abre nombre, email, centro y rol, "Cambiar de centro" (si tiene más de uno) y "Salir".
- [ ] **Panel (inicio):** turnos de hoy, anillo de asistencias, turnos de los próximos 7 días, pacientes, "Salas en tiempo real" (cada turno con el color de la disciplina), el próximo turno y la asistencia por profesional.

### 4.2 Qué puede hacer cada rol

| Acción | Admin | Recepción | Profesional |
| --- | --- | --- | --- |
| Ver salas | ✔ | ✔ | ✔ |
| Crear, editar y dar de baja salas | ✔ | — | — |
| Ver profesionales | ✔ | ✔ | ✔ |
| Ver porcentaje de liquidación | ✔ (todos) | — | solo el suyo |
| Crear y editar profesionales | ✔ | — | — |
| Ver pacientes | todos | todos | solo los asignados |
| Crear y editar pacientes | ✔ | ✔ | — (ficha en solo lectura) |
| Ver cobros (sesiones, resumen, para revisar) | todos | todos | solo los suyos |
| Cobrar, cargar órdenes, tokens, marcar presentadas | ✔ | ✔ | — |
| Cargar el valor de la sesión | ✔ | — (lo ve) | — |
| Ver liquidaciones | todas | — | solo la suya |
| Generar, marcar pagada o reabrir una liquidación | ✔ | — | — |

- [ ] Entrar con cada rol y verificar la tabla: los botones de editar aparecen solo donde corresponde.
- [ ] **Acceso por URL:** con `profesional@demo.local`, abrir http://localhost:4200/pacientes/nuevo → redirige al inicio.

### 4.3 Salas (admin)

- [ ] Crear "Sala 2" con descripción → aparece en la lista.
- [ ] Crear otra "Sala 2" → "Ya existe un registro con ese nombre".
- [ ] Editar la descripción → se actualiza.
- [ ] "Dar de baja" → desaparece; tildar "Ver dadas de baja" → aparece marcada "De baja"; "Reactivar" → vuelve.

### 4.4 Profesionales (admin)

- [ ] Crear un profesional con porcentaje 150 → el formulario no lo acepta (0 a 100).
- [ ] Crear "Laura Fernández", Fonoaudiología, 55 % → aparece en la lista con su porcentaje.
- [ ] Editar y vincular la cuenta: en "Cuenta para iniciar sesión" solo aparecen usuarios con rol profesional.
- [ ] Entrar como `recepcion@demo.local` → ve los profesionales **sin** porcentaje.

### 4.5 Pacientes (admin o recepción)

- [ ] "Nuevo paciente": nombre, apellido, DNI con puntos (`40.222.333`), fecha de nacimiento, tutor → al crear abre la ficha y el DNI queda sin puntos.
- [ ] DNI repetido (otra persona con `30111222`) → "Ya existe un registro con ese dni".
- [ ] Tildar "Tiene CUD" → aparece el vencimiento; destildar y guardar → el vencimiento se borra.
- [ ] Asignar y quitar profesionales en la ficha → "Cambios guardados" y la lista muestra los apellidos.
- [ ] **Búsqueda:** probar `gomez` (sin tilde), `GÓMEZ`, `30.111`, `juana gom`, parte del teléfono → encuentra a Juana; `xyz` → "No hay pacientes que coincidan".
- [ ] "Dar de baja" en la ficha → desaparece de la lista; "Ver dados de baja" la muestra.

### 4.6 Profesional y sus pacientes

- [ ] Entrar con `profesional@demo.local` en **Centro Demo** → Pacientes muestra solo a Juana (la tiene asignada) y el aviso "Ves los pacientes que tenés asignados".
- [ ] Abrir la ficha → todos los campos deshabilitados, sin Guardar ni Dar de baja.
- [ ] Como admin, quitarle a Juana el profesional → al volver como profesional, la lista queda vacía.

### 4.7 Aislamiento entre centros

- [ ] Entrar con `profesional@demo.local` en **Centro Demo Norte** (rol Recepción) → Pacientes, Salas y Profesionales están vacíos: no ve nada de Centro Demo.
- [ ] Crear ahí un paciente con DNI `30111222` (el mismo de Juana) → se permite: el DNI es único **por centro**.
- [ ] Copiar la URL de la ficha de Juana (Centro Demo) y abrirla estando en Centro Demo Norte → "Paciente no encontrado".

### 4.8 Agenda (admin o recepción)

- [ ] **Vistas:** Agenda → Día, Semana y Salas; las flechas, "Hoy" y el selector de fecha cambian el período.
- [ ] **Alta rápida:** tocar un hueco del calendario → se abre el panel con la fecha y la hora de ese hueco. Elegir paciente, profesional y sala → "Agendar".
- [ ] **Superposición de sala:** otro turno en la misma sala que se pise con el anterior → "La sala … está ocupada de … a …".
- [ ] **Superposición de profesional:** el mismo profesional en otra sala a la misma hora → "… ya tiene un turno de … a …".
- [ ] **Contiguos:** un turno que empieza justo cuando termina otro → se permite.
- [ ] **Mover y cancelar:** tocar un turno → "Mover o editar" (cambiar hora o sala) → se mueve; "Cancelar turno" con motivo → desaparece y libera el horario.
- [ ] **Semanales:** "Repetir todas las semanas" con fecha hasta → informa cuántos se agendaron y qué fechas chocan.
- [ ] **Terminar semanales:** en un turno semanal, "Terminar los semanales desde esta fecha" → se cancelan los siguientes.
- [ ] **Filtros:** por profesional y por sala, en las vistas Día y Semana.

### 4.9 El profesional en la agenda y los avisos

- [ ] Entrar con `profesional@demo.local` (Centro Demo) → la agenda muestra solo sus turnos. En "Nuevo turno" no elige profesional y solo aparecen sus pacientes asignados.
- [ ] Agendar, mover y cancelar un turno propio → el panel aclara que administración y recepción reciben el aviso.
- [ ] Vista **Salas** como profesional → los turnos de otros aparecen como "Ocupada", sin nombre de paciente.
- [ ] Entrar con `admin@demo.local` → en la barra, "Avisos" con el contador → la pantalla Avisos muestra cada cambio ("Pablo Pérez agendó un turno con …"). "Marcar leído" o "Marcar todos como leídos" baja el contador.
- [ ] Entrar con `recepcion@demo.local` → tiene sus propios avisos sin leer: cada persona marca los suyos.
- [ ] Los cambios que hacen admin o recepción **no** generan avisos.

### 4.10 Asistencia (admin o recepción)

- [ ] En la agenda, tocar un turno de hoy que ya empezó → sección **Asistencia** → "Presente". El turno muestra "· Presente" y una marca verde a la izquierda; los ausentes se ven rayados y con borde punteado. El color de fondo de cada turno es el de la disciplina del profesional.
- [ ] Un turno futuro → "Presente" y "Ausente sin aviso" están desactivados; "Ausente con aviso" sí se puede marcar.
- [ ] Con la asistencia marcada, "Mover o editar" y "Cancelar" desaparecen → "Volver a pendiente" los habilita de nuevo.
- [ ] "Ver ficha del paciente" → encabezado con edad, disciplina, obra social y estado; indicadores de asistencia (una barrita por sesión), próximo turno y sesiones del mes. Pestaña **Sesiones**: la lista de turnos con su estado.
- [ ] En la pestaña Sesiones, elegir el mes → **Ver planilla** → fechas precargadas, obra social, n.º de afiliado y columna para firmar. "Imprimir" deja solo la planilla (sin menú). "Mes anterior" y "Mes siguiente" cambian el mes.

### 4.10 bis Registro de asistencia (pantalla Asistencia)

- [ ] Menú **Asistencia** → los turnos del día, con "Llegó", "Ausente" y "Justificada".
- [ ] Tocar "Llegó" → la fila se marca y suben "Llegaron" y el porcentaje del anillo. Tocar "Llegó" otra vez → vuelve a "Por llegar".
- [ ] En un turno que todavía no empezó, "Llegó" y "Ausente" están desactivados; "Justificada" (avisó que no viene) sí se puede marcar.
- [ ] Las pestañas Todos, Por llegar, Llegaron y Ausentes filtran la lista y muestran cuántos hay.
- [ ] Las flechas cambian de día; "Hoy" vuelve al día actual.
- [ ] Como profesional, solo aparecen sus turnos.

### 4.10 ter Obras sociales (admin)

- [ ] Menú **Obras sociales** (admin y recepción) → aparecen OSEP, Prepaga Salud y CUD (datos demo) con sus reglas como etiquetas.
- [ ] Como admin, "Nueva obra social": nombre, tipo, código de prestación, sesiones por semana, validez de la orden, "necesita orden" o "necesita token" → "Agregar". Un nombre repetido → "Ya existe un registro con ese nombre".
- [ ] "Editar" carga los datos en el formulario; "Dar de baja" la oculta (tildar "Ver dadas de baja" para verla).
- [ ] Como recepción, se ve la lista pero no el formulario.
- [ ] En la ficha de un paciente → "Editar datos" → **Obra social** → elegir OSEP y guardar → el encabezado muestra OSEP. "Particular (sin obra social)" la quita.
- [ ] Con OSEP (hasta 3 por semana), agendar 4 turnos al paciente en la misma semana → la ficha avisa qué semana se pasa.
- [ ] Con CUD que vence en menos de 30 días (o vencido), la ficha muestra el aviso para pedir la renovación.

### 4.10 quater Cobros y liquidación (admin o recepción)

Los datos demo traen el valor de la sesión (particular $ 12.000, OSEP $ 9.500, Prepaga Salud $ 11.000, CUD $ 10.500). Para probar hacen falta turnos ya pasados marcados como presentes: agendar algunos en días anteriores del mes y marcarlos "Llegó" en Asistencia.

- [ ] **Obras sociales** → sección "Valor de la sesión": se ve el valor vigente de cada cobertura. Como admin, cargar un aumento con fecha de hoy → "Valor guardado" y, si había sesiones sin cobrar desde esa fecha, cuántas se actualizaron. Recepción la ve sin el formulario.
- [ ] Marcar presente un turno → menú **Cobros y liquidación** → aparece la sesión con el valor de su cobertura, "Por cobrar". Volverla a "Por llegar" en Asistencia → desaparece de Cobros.
- [ ] **Cobrar** en la fila → pasa a "Cobrada" con el medio elegido en "Cobrar con". Con un pago registrado, cambiar la asistencia de ese turno → error "La sesión tiene pagos registrados".
- [ ] **Detalle**: registrar un pago parcial (monto menor) → "Pago parcial" y "debe $ …". Un monto mayor al saldo → error. "Rechazado" en un pago → la sesión queda "Rechazada". "Borrar" lo quita.
- [ ] Paciente con **OSEP** (pide orden): su sesión muestra "Falta la orden". En la ficha → pestaña **Pagos** → "Agregar orden" (número, emisión, sesiones) → la sesión toma la orden sola; el indicador "Orden de OSEP" muestra las sesiones libres y el vencimiento (emisión + 30 días).
- [ ] Paciente con **Prepaga Salud** (pide token): "Falta el token" → en el detalle cargar el token → el aviso se va.
- [ ] Elegir varias sesiones con las casillas → "Marcar presentadas" y "Cobrar el saldo" en lote.
- [ ] **Para revisar** muestra cuántas sesiones tienen cada problema; tocar uno filtra la tabla.
- [ ] Ficha → **Saldo**: suma lo que falta cobrar del paciente.
- [ ] **Panel**: "Cobrado este mes" y lo que falta cobrar.
- [ ] **Liquidación** (admin): una tarjeta por profesional con sesiones, facturado, retención del centro (100 − porcentaje del profesional) y a liquidar. Con turnos del mes sin marcar, "Generar liquidación" está desactivado y lo explica.
- [ ] En un mes ya terminado y todo marcado, "Generar liquidación" → "Generada". Cambiar la asistencia de un turno de ese mes → error "La liquidación de ese mes ya está cerrada". "Reabrir" lo vuelve a permitir; "Marcar pagada" la deja cerrada para siempre.
- [ ] Como profesional vinculado a una ficha: ve solo sus sesiones y su liquidación, sin botones para cobrar ni liquidar. Recepción no ve la pestaña Liquidación.

### 4.10 quinquies Planes y módulos (superadmin)

- [ ] Entrar con `superadmin@demo.local` → **Centros y planes**: se ven Centro Demo (Integral) y Centro Demo Norte (Básico), y los tres planes con sus módulos.
- [ ] Cambiar el plan de Centro Demo a **Básico** → entrar con `admin@demo.local` (o renovar la sesión): desaparecen Cobros, Obras sociales, Presentación y Facturación del menú, la pestaña Pagos y el saldo de la ficha, y "Cobrado este mes" del panel. Abrir http://localhost:4200/cobros a mano → vuelve al inicio. Volver a Integral.
- [ ] En un plan, destildar un módulo y "Guardar" → la API lo bloquea enseguida (403 "El plan del centro no incluye …"); el menú se actualiza al renovar la sesión.
- [ ] "Nuevo centro" con nombre, identificador, plan y su administrador (con contraseña si la cuenta no existe) → aparece en la lista y esa cuenta ya puede entrar. "Dar de baja" lo desactiva.

### 4.10 sexies Facturación electrónica (admin o recepción)

Arranca en **modo simulado**: no se conecta con ARCA y las facturas no tienen validez fiscal.

- [ ] Con sesiones particulares cobradas en el mes (ver 4.10 quater), menú **Facturación** → mes de esas sesiones → "Para facturar" muestra cada paciente con sus sesiones agrupadas por precio y el total. Los que tienen sesiones sin cobrar aparecen en "Revisar antes de facturar".
- [ ] Elegir pacientes → "Emitir facturas elegidas" → confirmar → pestaña **Emitidas** con número, CAE y vencimiento. "PDF" abre la factura con la letra C, el QR y "SIN VALIDEZ FISCAL".
- [ ] "Compartir": en el celular abre compartir con el PDF; en la computadora lo descarga y abre el chat de WhatsApp del paciente. Queda marcada como enviada.
- [ ] Una sesión ya facturada no se puede cambiar de asistencia ni de monto (error).
- [ ] **Datos fiscales** (admin): CUIT, razón social, domicilio, inicio de actividades, punto de venta y modo. "Generar pedido de certificado" descarga `pedido-arca.csr`. Cargar un certificado que no es de esa clave → error.
- [ ] **Con certificado real de ARCA (homologación):** subir el pedido en ARCA ("Administración de certificados digitales"), autorizar "Facturación electrónica" en el "Administrador de relaciones", cargar el `.crt`, crear un punto de venta "RECE para aplicativo y web services", pasar a "Homologación" y "Probar conexión" → muestra el estado de los servidores y el último número del punto de venta.

### 4.10 septies Presentación a obras sociales (admin o recepción)

- [ ] Menú **Presentación a obras sociales** → arranca en OSEP (o la primera que pide orden o token) → resumen con sesiones, con orden, con token y presentadas.
- [ ] Con una orden de OSEP emitida después de algunas sesiones del mes: "Completar fechas sugeridas" → las sesiones anteriores a la orden se declaran desde la emisión, una por día y hasta 3 por semana; cada una dice por qué se movió.
- [ ] Cambiar a mano una fecha a declarar → queda guardada.
- [ ] Prepaga Salud (pide token): "Cargar tokens" → pegar `AB12CD 30111222` (token y DNI) → "Revisar" muestra a qué paciente y sesión va → "Guardar". Un token repetido aparece como "Repetido".
- [ ] "Marcar presentadas" en un paciente → sus sesiones con fecha quedan presentadas (también en Cobros).

### 4.11 Notas de sesión (profesional)

- [ ] Entrar con `profesional@demo.local` → Pacientes → abrir uno → pestaña **Notas** → escribir una nota y "Agregar nota" → aparece como "Privada".
- [ ] Escribir otra con "Compartir con el equipo" → aparece como "Compartida". "Editar" cambia el texto o si se comparte.
- [ ] Con admin o recepción, la ficha del paciente **no** muestra notas.
- [ ] En la base (sección 6), `SELECT texto FROM notas_sesion;` muestra solo texto cifrado (`v1:…`), nunca la nota.
- [ ] Para probar el compartir entre profesionales hace falta un segundo profesional con cuenta, asignado al mismo paciente (hoy se vincula por API; las pantallas de usuarios son un pendiente).

### 4.12 Celular

- [ ] En el navegador, abrir las herramientas de desarrollo (F12) → modo dispositivo (Ctrl+Shift+M) → iPhone o similar. El menú lateral pasa a una barra inferior (Panel, Agenda, Asistencia, Pacientes y "Más") y no hay scroll horizontal.
- [ ] "Más" abre Profesionales, Salas, "Salir" y el sello DaviNic.
- [ ] En la agenda aparece el botón flotante "+" para un turno nuevo.
- [ ] En Asistencia, los botones ocupan todo el ancho y se tocan fácil.

---

## 5. Pruebas de la API (Swagger)

Abrir http://localhost:3000/api/docs.

1. `POST /api/v1/auth/login` → **Try it out** → cuerpo `{"email": "admin@demo.local", "password": "<DEMO_PASSWORD>"}` → **Execute**.
2. Copiar `accessToken` de la respuesta → botón **Authorize** arriba a la derecha → pegarlo → **Authorize**.
3. Ya se pueden probar las demás rutas con ese usuario.

Casos:

- [ ] `GET /api/v1/pacientes?q=gomez` → devuelve `items`, `total`, `pagina`, `porPagina`.
- [ ] `POST /api/v1/salas` con `{"nombre": ""}` → 400 con el detalle de validación.
- [ ] Sin Authorize, cualquier ruta salvo `health` y `auth/login` → 401.
- [ ] **Superadmin** (también desde la pantalla "Centros y planes"): login con `superadmin@demo.local`, Authorize, y `POST /api/v1/centros`:
  ```json
  {
    "nombre": "Centro Prueba",
    "slug": "centro-prueba",
    "plan": "profesional",
    "admin": { "email": "admin-prueba@demo.local", "nombre": "Admin Prueba", "password": "una-clave-de-prueba" }
  }
  ```
  → 201. Después, entrar a la app con `admin-prueba@demo.local` → Centro Prueba vacío.
- [ ] Con un token de admin, `GET /api/v1/centros` → 403 (solo superadmin).
- [ ] **Rotación del refresh token:** hacer login, copiar `refreshToken`, llamar dos veces `POST /api/v1/auth/refresh` con el **mismo** token → la primera responde 200 con un token nuevo; la segunda responde 401 y además invalida el token nuevo (detección de robo).
- [ ] **Usuarios del centro (admin):** `POST /api/v1/usuarios` con `{"email": "nuevo@demo.local", "nombre": "Nuevo", "rol": "recepcion", "password": "una-clave-de-prueba"}` → 201; esa cuenta ya puede entrar.

---

## 6. Ver la base de datos

```bash
cd backend && npm run db:studio
```

Abre Prisma Studio en el navegador con todas las tablas. Para ver el aislamiento: en `pacientes`, `salas`, etc., cada fila tiene su `centro_id`.

Con `psql` (en `C:\Program Files\PostgreSQL\17\bin\`), la conexión es la `DATABASE_URL` de `backend/.env`:

```sql
SELECT c.nombre AS centro, p.apellido, p.nombre, p.dni, p.busqueda
FROM pacientes p JOIN centros c ON c.id = p.centro_id
ORDER BY c.nombre, p.apellido;
```

Para probar que la base rechaza datos cruzados (falla con `viola la llave foránea «turnos_centro_id_paciente_id_fkey»`):

```sql
-- Un turno en Centro Demo Norte con una paciente de Centro Demo: la base lo rechaza.
INSERT INTO turnos (id, centro_id, paciente_id, profesional_id, inicio, fin)
SELECT gen_random_uuid(), n.id, p.id, pr.id, now(), now() + interval '45 minutes'
FROM centros n, pacientes p, profesionales pr
WHERE n.slug = 'demo-norte' AND p.apellido = 'Gómez' AND pr.apellido = 'Pérez';
```

---

## 7. Tests automáticos

```bash
cd backend && npm test
```

```bash
cd backend && npm run test:e2e
```

```bash
cd frontend && npx ng test --watch=false
```

| Suite | Cantidad | Qué cubre |
| --- | --- | --- |
| Backend unitarios | 46 | variables de entorno, contraseñas, filtro por centro, búsqueda sin tildes, fechas y zonas horarias, cifrado de notas, reglas de cobro y liquidación, cliente ARCA (firma CMS, ticket, Factura C, QR), fechas a declarar y tokens |
| Backend e2e | 122 | auth y roles, ABM, agenda (superposición, pedidos simultáneos, semanales), avisos, asistencia (permisos, mes cerrado, registro de cambios), historial, planilla, notas cifradas y quién las ve, obras sociales y sus reglas, cobros (precios, órdenes, pagos, conciliación) y liquidación, planes y módulos, facturación (simulada y contra un ARCA de prueba), presentación a obras sociales, aislamiento entre centros, contra PostgreSQL real |
| Frontend | 34 | sesión, "Recordarme", renovación de token, login, tema claro/oscuro, fechas, ubicación de turnos en el calendario, cuándo se puede marcar asistencia, colores por disciplina, enlaces de WhatsApp y edad, formato de pesos y meses |

Los e2e usan la base `centro_integral_test` (`TEST_DATABASE_URL`), que se vacía en cada corrida: nunca tocan los datos de desarrollo.

Lint: `npm run lint` en cada carpeta. En esta PC, Windows (Control de aplicaciones) bloquea el ejecutable de las reglas con tipos del lint del backend; mientras tanto: `npx oxlint --ignore-pattern "src/generated/**" src/ test/`.

---

## 8. Limitaciones conocidas (todavía no hechas)

- ARCA: probado contra un servidor simulado en los tests; falta una prueba en homologación con un certificado real. Factura el centro con su CUIT (no cada profesional).
- Obras sociales: los tokens y las órdenes se cargan a mano o pegados como texto (todavía sin leerlos de fotos).
- Liquidación: no hay todavía un comprobante para imprimir o mandarle al profesional.
- Recuperar la contraseña desde el login: no existe todavía; la cambia quien administra el centro.
- Pantalla para administrar usuarios del centro: hoy solo por API.
- Cambio de rol o baja de un usuario: se aplica en como mucho 15 minutos (vida del access token).
- En la web el refresh token queda en `localStorage`: antes de producción, pasarlo a cookie httpOnly.

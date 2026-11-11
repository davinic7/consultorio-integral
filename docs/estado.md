# Estado del desarrollo

Actualizado: 11 de noviembre de 2026. Orden de pasos según [prototipo.md](prototipo.md).

## Hecho

| Paso | Qué | Commit |
| --- | --- | --- |
| 1 | Estructura: `backend/` (NestJS 12 + Prisma 7.10.1), `frontend/` (Angular 22), PostgreSQL 17 local | `3d12dae` |
| 2 | Modelo de datos multi-centro: `centro_id` y claves foráneas compuestas en todas las tablas, `paraCentro()` | `b663287` |
| 3 | Usuarios, login con tokens rotativos y roles por centro; login en Angular | `d04baf2` |
| 4 | ABM de salas, profesionales y pacientes; búsqueda sin tildes; menú por rol | `032f01e` |
| 5 | Agenda: superposición controlada por PostgreSQL, turnos semanales, vistas día, semana y salas; el profesional gestiona los suyos y se avisa a admin y recepción | `ac8c46d` |
| 6 | Asistencia en un clic desde la agenda (corregible hasta cerrar el mes, con registro de cambios), historial, planilla mensual para imprimir, notas de sesión cifradas y compartibles; sesión de la base en UTC | (este commit) |

Cómo probar todo: [guia-de-pruebas.md](guia-de-pruebas.md).

## Paso 7 — Financiadores (hecho)

Obras sociales, prepagas y CUD por centro con sus reglas (código de prestación, orden por sesión, token por sesión, máximo semanal y validez de la orden); pantalla "Obras sociales"; selector en la ficha; avisos de CUD por vencer y de semanas con más sesiones de las que cubre la obra social. Datos demo: OSEP, Prepaga Salud y CUD.

## Paso 8 — Conciliación y liquidación (hecho)

- **Backend** (`src/cobros/`): cada turno presente crea su prestación con la cobertura del paciente, el valor vigente ese día y, si la obra social la pide, una orden con lugar. Precios con historial (por cobertura y especiales por paciente), órdenes con vencimiento y cupo, token por sesión, pagos (uno a uno o en lote, con rechazos), resumen del mes, conciliación y liquidación por porcentaje que cierra el mes.
- **Frontend**: pantalla **Cobros y liquidación** (`/cobros`) del rediseño, pestaña Pagos e indicadores de saldo y orden en la ficha, valor de la sesión en Obras sociales y cobros del mes en el panel.
- Migración `cobros_y_liquidacion`; precios en los datos demo; 5 tests unitarios y 18 e2e nuevos.

## Próximos (pasos 9 y 10)

9. Planes y habilitación de módulos (hoy todos los centros ven Cobros).
10. Portar ARCA (Factura C) y OSEP desde `referencia-php/`: la marca "presentada" de cada sesión pasa a salir de la factura o de la presentación.

## Pendientes chicos anotados

- Pantallas para el superadmin (centros y planes) y para administrar usuarios del centro: hoy solo por API.
- Refresh token de la web en cookie httpOnly antes de producción.
- Tests de frontend para las pantallas de salas, profesionales, pacientes, agenda, planilla y notas (hoy probadas a mano).
- Lint del backend: Windows (Control de aplicaciones) bloquea `tsgolint.exe`, el ejecutable de las reglas con tipos. Se corre `oxlint` sin `--type-aware` hasta resolverlo.
- `backend/AGENTS.md` (generado por NestJS, promociona su telemetría): decidir si se borra.
- Agenda: arrastrar y soltar turnos para moverlos (hoy se mueven desde el panel) y horario visible configurable por centro (hoy 07:00 a 22:00).
- Avisos: hoy se consultan cada minuto; más adelante, notificaciones push en la app móvil.
- Cobros: un faltazo sin aviso de un particular no genera cobro (en la referencia PHP sí se cobraba); decidir si se agrega como regla por centro.
- Cobros: comprobante de liquidación para imprimir o mandar al profesional.
- `backend/package.json` pide Node ≥ 24, pero Temporal recién viene activado en Node 26 (en Node 24 hace falta `--harmony-temporal`): subir el mínimo a 26.
- Arranque en Render: si falla un paso opcional (superadmin o datos demo, por ejemplo por una contraseña corta) el contenedor no arranca; evaluar que esos pasos solo avisen en el log.

## Rediseño Órbita Cian

Guía: [diseno/orbita-cian.md](diseno/orbita-cian.md). Migración hecha (pasos del "Orden sugerido"):

- 1 a 3: fuentes, tema claro/oscuro, shell (menú lateral, barra superior, barra inferior en celular) y login.
- 4 a 7: panel principal, agenda, ficha del paciente y registro de asistencia (`/asistencia`, nuevo).
- 8: Cobros y liquidación (`/cobros`), con los indicadores de cobros del panel y de saldo y orden en la ficha. Los gráficos van debajo de la tabla salvo en pantallas de 1600 px o más.
- 9: profesionales, salas, avisos, pacientes, planilla y elegir centro con las clases `oc-*`; `styles.scss` ya no tiene los estilos viejos.

La migración del rediseño está completa.

## Publicado

Desde el 9 de noviembre de 2026 en **https://centro-integral.onrender.com** (Render, plan gratis, Blueprint de [render.yaml](../render.yaml); guía en [publicar.md](publicar.md)). Con datos demo y el superadmin del dueño. Se vuelve a publicar solo con cada push a `main`.

- El servicio se duerme tras 15 minutos sin uso; el primer arranque tardó unos 13 minutos en levantar el contenedor.
- La base gratis vence a los 30 días de creada (alrededor del 9 de diciembre de 2026).

## Cómo retomar

1. Levantar PostgreSQL (servicio `postgresql-x64-17`), el backend y el frontend: ver [guia-de-pruebas.md](guia-de-pruebas.md), sección 1.
2. Antes de empezar, correr los tests para confirmar que todo sigue en verde (sección 7 de la guía).
3. Decisiones técnicas tomadas hasta acá: [decisiones.md](decisiones.md).

# Estado del desarrollo

Actualizado: 11 de noviembre de 2026 (versión 1.0). Orden de pasos según [prototipo.md](prototipo.md).

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

## Paso 9 — Planes y módulos (hecho)

- `@RequiereModulo` en los controllers: el plan del centro tiene que incluir el módulo (403 si no). El frontend oculta del menú, las rutas, la ficha y el panel lo que el plan no incluye (la sesión trae el plan y sus módulos).
- Pantalla **Centros y planes** (`/plataforma`) para el superadmin: alta de centros con su primer administrador, cambio de plan, baja, y precio y módulos de cada plan.
- 5 tests e2e nuevos.

## Paso 10 — ARCA y obras sociales (hecho)

- **Facturación electrónica** (`src/facturacion/`, pantalla `/facturacion`): Factura C con ARCA portada de `Arca.php` (WSAA con firma CMS + WSFEv1), en modo simulado, homologación o producción. Datos fiscales y certificado del centro (la clave privada se genera en el sistema y se guarda cifrada). Una factura por paciente particular con las sesiones cobradas del mes; PDF con el formato de ARCA y su QR; compartir por WhatsApp.
- **Presentación a obras sociales** (`/presentacion`): lo de OSEP de la referencia, para cualquier obra social: fecha a declarar sugerida por las reglas (desde la orden, una por día, máximo semanal, antes del vencimiento), tokens pegados como texto emparejados por afiliado o DNI, y marca de presentada.
- 12 tests unitarios y 7 e2e nuevos. Se probó contra un ARCA simulado en los tests; **falta probar en homologación con un certificado real**.

## Prototipo completo

Los 10 pasos de [prototipo.md](prototipo.md) están hechos (versión 1.0).

## Después de la 1.0

- **Usuarios del centro** (`/usuarios`, solo administración): alta con rol y contraseña inicial (vacía si el email ya tiene cuenta en otro centro), cambio de rol, baja y reactivación. El admin no puede cambiarse el rol ni darse de baja a sí mismo. 6 tests de frontend nuevos.

## Pendientes chicos anotados

- ARCA: probar en homologación con un certificado real del centro antes de pasar a producción. Decidir si cada profesional factura con su propio CUIT (hoy factura el centro).
- Obras sociales: leer órdenes y tokens desde fotos (la referencia usaba OCR en el navegador) y planilla de la orden en PDF.
- Módulo "reportes" del plan: todavía no tiene pantallas propias.
- Refresh token de la web en cookie httpOnly antes de producción.
- Tests de frontend para las pantallas de salas, profesionales, pacientes, agenda, planilla y notas (hoy probadas a mano).
- Lint del backend: Windows (Control de aplicaciones) bloquea `tsgolint.exe`, el ejecutable de las reglas con tipos. Se corre `oxlint` sin `--type-aware` hasta resolverlo.
- `backend/AGENTS.md` (generado por NestJS, promociona su telemetría): decidir si se borra.
- Agenda: arrastrar y soltar turnos para moverlos (hoy se mueven desde el panel) y horario visible configurable por centro (hoy 07:00 a 22:00).
- Avisos: hoy se consultan cada minuto; más adelante, notificaciones push en la app móvil.
- Cobros: un faltazo sin aviso de un particular no genera cobro (en la referencia PHP sí se cobraba); decidir si se agrega como regla por centro.
- Cobros: comprobante de liquidación para imprimir o mandar al profesional.
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

# Estado del desarrollo

Actualizado: 9 de noviembre de 2026. Orden de pasos según [prototipo.md](prototipo.md).

## Hecho

| Paso | Qué | Commit |
| --- | --- | --- |
| 1 | Estructura: `backend/` (NestJS 12 + Prisma 7.10.1), `frontend/` (Angular 22), PostgreSQL 17 local | `3d12dae` |
| 2 | Modelo de datos multi-centro: `centro_id` y claves foráneas compuestas en todas las tablas, `paraCentro()` | `b663287` |
| 3 | Usuarios, login con tokens rotativos y roles por centro; login en Angular | `d04baf2` |
| 4 | ABM de salas, profesionales y pacientes; búsqueda sin tildes; menú por rol | `032f01e` |
| 5 | Agenda: superposición controlada por PostgreSQL, turnos semanales, vistas día, semana y salas; el profesional gestiona los suyos y se avisa a admin y recepción | `ac8c46d` |

Cómo probar todo: [guia-de-pruebas.md](guia-de-pruebas.md).

## Próximo: paso 6 — Asistencia, pacientes compartidos y notas cifradas

Lo que pide el prototipo (Módulo 2 y parte del 4):

- Estado de cada turno: pendiente, presente, ausente con aviso, ausente sin aviso, cancelado por profesional. La columna ya existe; falta poder marcarlo.
- Marcado en un clic desde la agenda.
- Historial de asistencia por paciente.
- Planilla mensual de asistencia por paciente y obra social, lista para imprimir y firmar.
- Notas de sesión privadas del profesional, con opción de compartir con el equipo, guardadas cifradas. Se porta `referencia-php/app/lib/crypto.php` (AES-256-GCM con una clave por centro).

Decisiones abiertas para el paso 6:

- ¿Quién marca la asistencia: todos los roles, o el profesional solo la de sus turnos?
- Un turno ya marcado (presente o ausente), ¿se puede corregir? ¿Hasta cuándo?

## Después (pasos 7 a 10)

7. Financiadores genéricos (obras sociales, prepagas, CUD) con sus reglas; selector en la ficha del paciente.
8. Conciliación de asistencia contra lo facturado y liquidación por porcentaje.
9. Planes y habilitación de módulos.
10. Portar ARCA (Factura C) y OSEP desde `referencia-php/`.

## Pendientes chicos anotados

- Pantallas para el superadmin (centros y planes) y para administrar usuarios del centro: hoy solo por API.
- Refresh token de la web en cookie httpOnly antes de producción.
- Tests de frontend para las pantallas de salas, profesionales, pacientes y agenda (hoy probadas a mano).
- `backend/AGENTS.md` (generado por NestJS, promociona su telemetría): decidir si se borra.
- Agenda: arrastrar y soltar turnos para moverlos (hoy se mueven desde el panel) y horario visible configurable por centro (hoy 07:00 a 22:00).
- Avisos: hoy se consultan cada minuto; más adelante, notificaciones push en la app móvil.
- Arranque en Render: si falla un paso opcional (superadmin o datos demo, por ejemplo por una contraseña corta) el contenedor no arranca; evaluar que esos pasos solo avisen en el log.

## Publicado

Desde el 9 de noviembre de 2026 en **https://centro-integral.onrender.com** (Render, plan gratis, Blueprint de [render.yaml](../render.yaml); guía en [publicar.md](publicar.md)). Con datos demo y el superadmin del dueño. Se vuelve a publicar solo con cada push a `main`.

- El servicio se duerme tras 15 minutos sin uso; el primer arranque tardó unos 13 minutos en levantar el contenedor.
- La base gratis vence a los 30 días de creada (alrededor del 9 de diciembre de 2026).

## Cómo retomar

1. Levantar PostgreSQL (servicio `postgresql-x64-17`), el backend y el frontend: ver [guia-de-pruebas.md](guia-de-pruebas.md), sección 1.
2. Antes de empezar, correr los tests para confirmar que todo sigue en verde (sección 7 de la guía).
3. Decisiones técnicas tomadas hasta acá: [decisiones.md](decisiones.md).

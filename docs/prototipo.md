# Prototipo — Sistema de gestión para Centros de Atención Integral

DaviNic Developer · Stack: TypeScript · Node.js · Angular · PostgreSQL · Noviembre 2026

## Origen

Basado en el relevamiento "Relevamiento Sistema de Gestión" (5 respuestas, mayormente centros interdisciplinarios con más de 6 salas y más de 15 profesionales). Dolores principales: registro de asistencias y cobros, información en papel desordenada, coordinación de salas por WhatsApp, y diferencias entre asistencia real y lo facturado (afecta el porcentaje de cada profesional). Ningún centro usa sistema hoy.

## Punto de partida: el consultorio como referencia

El Centro Integral se escribe desde cero en TypeScript: backend en Node.js, frontend en Angular y base PostgreSQL. El sistema del consultorio (PHP 8.1, repo davinic7/forProfessional) queda como producto aparte y su código vive en `referencia-php/` solo como guía de lógica y reglas de negocio; no se ejecuta.

- **Lógica a portar desde la referencia:** aislamiento obligatorio de datos por cuenta (`q()` + `pf()` → filtro por `centro_id` en cada consulta), cifrado AES-256-GCM por cuenta (`crypto.php`), cliente ARCA WSAA/WSFE con Factura C (`Arca.php`), PDF con QR (`Pdf.php`), reglas de sesiones y cobro (`reglas.php`), precios con historial, módulo OSEP, lectura de tokens y órdenes en el navegador, dictado.
- **Estructura del repo davinic7/consultorio-integral:** `backend/` (Node.js + TypeScript), `frontend/` (Angular), `docs/prototipo.md`, `referencia-php/`.
- **Nunca en git:** `.env` con claves, `referencia-php/config.php`, bases de datos, certificados ARCA.
- **Pendiente de decidir al arrancar:** framework de backend (Express o NestJS) y ORM (Prisma o TypeORM).

## Alcance del prototipo

1. **Centros (multi-tenant):** tabla `centros` y `centro_id` por encima de `profesional_id` en todas las tablas y en el filtro de `q()`.
2. **Varios usuarios y roles por centro:** administrador del centro, recepción y profesional.
3. **Salas:** tabla `salas` y validación de superposición de sala y profesional en la agenda.
4. **Pacientes compartidos:** un paciente atendido por varios profesionales; notas privadas por defecto con opción de compartir.
5. **Obras sociales genéricas:** tabla `financiadores` con reglas propias (token, orden, máximo semanal, vencimiento, código) en lugar de `particular`/`osep`; CUD con vencimiento.
6. **Asistencia y liquidación:** conciliación de sesiones asistidas contra facturadas y liquidación mensual por porcentaje de cada profesional.
7. **Planes:** tablas `planes` y `plan_modulos`; los módulos se habilitan según el plan del centro.

Los módulos 1 a 4 de abajo describen el comportamiento esperado; parte ya existe en el consultorio y se adapta. Fuera de alcance por ahora: robot de carga en SIA, lectura de órdenes con IA, informes a colegios profesionales.

## Visión: SaaS para centros

El objetivo final es un software como servicio para centros de atención y consultorios en general, ofrecido en distintos planes. El prototipo se construye desde el día uno preparado para eso.

- **Multi-centro (multi-tenant):** una sola base de datos con tabla **centros**; todas las tablas de datos llevan `centro_id` y cada consulta filtra por el centro del usuario logueado. Los datos de un centro nunca son visibles para otro.
- **Funciones por plan:** tablas **planes** (id, nombre, precio\_mensual) y **plan\_modulos** (plan\_id, modulo); cada centro tiene un plan\_id y el sistema habilita o bloquea módulos según ese plan.
- **Usuarios por centro:** cada usuario pertenece a un centro; un superadministrador (DaviNic) gestiona centros y planes.

| Plan | Pensado para | Módulos |
| --- | --- | --- |
| Básico | Consultorios chicos | Agenda con salas, asistencia, ficha del paciente |
| Profesional | Centros medianos | Básico + cobros y liquidación por profesional + reportes |
| Integral | Centros interdisciplinarios grandes | Profesional + obras sociales y CUD + facturación electrónica ARCA |

Primer caso a migrar más adelante: el consultorio de la psicóloga, como un centro más.

## Roles

- **Administrador**: configura centro, salas, profesionales, porcentajes.
- **Recepción**: gestiona turnos, asistencia, cobros, pacientes.
- **Profesional**: ve su agenda, marca asistencia, escribe notas de sus pacientes, ve su liquidación.

## Módulo 1 — Agenda de turnos con salas

- Vista calendario diaria y semanal, filtrable por profesional o por sala.
- Crear turno: paciente, profesional, sala, fecha, hora inicio y duración.
- Turnos recurrentes (ej. todos los martes 10:00) con fecha de fin.
- Validación de superposición: no permite misma sala o mismo profesional en horario solapado.
- Vista de disponibilidad de salas para reorganizar espacios.
- Diseño responsive (computadora y celular).

## Módulo 2 — Registro de asistencia

- Cada turno tiene estado: pendiente, presente, ausente con aviso, ausente sin aviso, cancelado por profesional.
- Marcado en un clic desde la agenda.
- Historial de asistencia por paciente.
- Exportar/imprimir planilla de asistencia mensual por paciente y obra social, con fechas precargadas, lista para firmar a mano.

## Módulo 3 — Cobros y liquidación

- Cada turno presente genera un registro de prestación con su financiador: particular, obra social/prepaga o CUD.
- Registro de pago: monto, fecha, medio de pago, estado (pendiente, cobrado, rechazado).
- Conciliación: comparar sesiones asistidas contra sesiones facturadas/cobradas y marcar diferencias.
- Liquidación mensual por profesional según porcentaje configurado.
- Reportes: listado de pacientes por profesional, facturación mensual, estado de pagos.

## Módulo 4 — Ficha del paciente

- Datos personales y de contacto, responsable o tutor (pacientes infantiles).
- Financiador y número de afiliado; CUD sí/no con vencimiento.
- Profesionales que lo atienden.
- Notas de sesión: privadas del profesional por defecto, con opción de compartir con el equipo.
- Búsqueda rápida por nombre, DNI o teléfono.

## Base de datos (PostgreSQL) — tablas iniciales

- **usuarios**: id, nombre, email, password\_hash, rol, activo
- **profesionales**: id, usuario\_id, disciplina, matricula, porcentaje\_liquidacion
- **salas**: id, nombre, descripcion, activa
- **pacientes**: id, nombre, apellido, dni, fecha\_nacimiento, telefono, email, responsable\_nombre, responsable\_telefono, financiador\_id, nro\_afiliado, tiene\_cud, cud\_vencimiento
- **financiadores**: id, nombre, tipo (particular, obra\_social, prepaga, cud)
- **paciente\_profesional**: paciente\_id, profesional\_id
- **turnos**: id, paciente\_id, profesional\_id, sala\_id, inicio, fin, recurrencia\_id, estado\_asistencia, observaciones
- **recurrencias**: id, dia\_semana, hora, duracion, fecha\_desde, fecha\_hasta
- **prestaciones**: id, turno\_id, financiador\_id, monto, facturada (bool), periodo
- **pagos**: id, prestacion\_id, monto, fecha, medio, estado
- **liquidaciones**: id, profesional\_id, periodo, total\_bruto, porcentaje, total\_liquidado, estado
- **notas\_sesion**: id, turno\_id, paciente\_id, profesional\_id, texto, compartida (bool), creada\_en

## Seguridad

- Login con contraseñas hasheadas y sesiones seguras.
- Permisos por rol; las notas clínicas solo las ve su autor salvo que se compartan.
- Backups automáticos de la base de datos.

## Orden de desarrollo sugerido

1. Estructura del repo: `backend/` y `frontend/` con TypeScript, ESLint y `.env.example`; PostgreSQL local
2. Modelo de datos con `centros` y `centro_id` en todas las tablas, migraciones
3. Usuarios, login y roles por centro (admin, recepción, profesional)
4. Pacientes, profesionales y salas (ABM)
5. Agenda con validación de superposición de sala y profesional
6. Asistencia, pacientes compartidos y notas cifradas compartibles
7. Financiadores genéricos y CUD
8. Conciliación de asistencia y liquidación por porcentaje
9. Planes y habilitación de módulos
10. Portar ARCA (Factura C) y OSEP desde `referencia-php/`

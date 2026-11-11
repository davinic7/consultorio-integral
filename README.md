# Centro Integral

SaaS para centros de atención integral.

Stack: TypeScript, Node.js, Angular, PostgreSQL.

`referencia-php/` contiene el sistema original del consultorio como guía.

## Qué hace (versión 1.0)

- Varios centros en una base, cada uno aislado, con planes que habilitan módulos.
- Usuarios con rol por centro: administración, recepción y profesional.
- Agenda con salas y control de superposición, turnos semanales y avisos.
- Asistencia en un toque, historial y planilla mensual para firmar.
- Pacientes compartidos y notas de sesión cifradas.
- Obras sociales con sus reglas, órdenes y tokens, y presentación mensual.
- Cobros, conciliación de lo asistido contra lo facturado y cobrado, y liquidación por profesional.
- Factura C electrónica con ARCA, con PDF y QR.

Estado y pendientes: [docs/estado.md](docs/estado.md). Cómo probar todo: [docs/guia-de-pruebas.md](docs/guia-de-pruebas.md).

## Estructura

- `backend/` — API NestJS + Prisma ([README](backend/README.md))
- `frontend/` — Angular ([README](frontend/README.md))
- `docs/` — [prototipo](docs/prototipo.md) y [decisiones de arquitectura](docs/decisiones.md)
- `referencia-php/` — sistema original del consultorio (solo lectura)
- `Dockerfile` y `render.yaml` — imagen de producción y publicación en Render ([cómo publicar](docs/publicar.md))

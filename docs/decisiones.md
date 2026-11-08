# Decisiones de arquitectura

Registro de decisiones técnicas del Centro Integral. Cada una dice qué se eligió y por qué.

## 1. Backend: NestJS (no Express)

NestJS da módulos, guards, interceptores e inyección de dependencias. Encaja con lo que pide el producto:

- **Multi-tenant:** el filtro obligatorio por `centro_id` se resuelve en un solo lugar (guard + contexto de request), no repetido en cada ruta.
- **Roles por centro** (admin, recepción, profesional) con guards y decoradores.
- **Módulos por plan:** cada funcionalidad es un módulo de Nest y un guard bloquea los que el plan del centro no incluye.
- **OpenAPI automático** con `@nestjs/swagger`, base para clientes tipados (web y móvil).

Express hubiera exigido armar todo eso a mano.

## 2. ORM: Prisma 7 (no TypeORM)

- Schema declarativo único (`backend/prisma/schema.prisma`) y migraciones SQL versionadas.
- Tipos generados estrictos: un error de columna es un error de compilación.
- Extensiones del cliente para inyectar `centro_id` en todas las consultas (equivalente a `q()` + `pf()` de la referencia PHP).
- Conexión con el driver `pg` (`@prisma/adapter-pg`).

Versión fijada en 7.10.1 (estable); la etiqueta `latest` de npm apuntaba a una 8.0 release candidate.

## 3. Base de datos: PostgreSQL

Además de lo relacional, ofrece Row Level Security, que más adelante puede sumar una segunda barrera de aislamiento entre centros a nivel de base.

## 4. API pensada para varios clientes (web hoy, Android/iOS mañana)

- Toda la lógica de negocio vive en el backend; el frontend solo presenta.
- Rutas versionadas: `/api/v1/...`. Las apps instaladas tardan en actualizarse, así que no se rompe una versión publicada.
- Contrato OpenAPI en `/api/openapi.json` (UI en `/api/docs`).
- Autenticación con tokens (access de vida corta + refresh) en lugar de solo cookies de sesión, porque en el celular las cookies funcionan mal.
- CORS configurable por `CORS_ORIGINS`.

## 5. Frontend: Angular, preparado para Capacitor

Para Android e iOS el plan es empaquetar la misma app Angular con Capacitor (acceso a cámara, notificaciones y biometría). Si alguna pantalla necesita rendimiento nativo, la API ya sirve para un cliente nativo aparte.

## 6. Validación y herramientas

- Variables de entorno validadas con Zod al arrancar (`backend/src/config/env.ts`): sin `DATABASE_URL` válida la API no levanta.
- Backend: Vitest y oxlint (el linter que trae NestJS 12, compatible con las reglas de ESLint).
- Frontend: Vitest y angular-eslint.
- Node.js ≥ 24 (desarrollo en Node 26).

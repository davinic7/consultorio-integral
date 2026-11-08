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

## 7. Aislamiento entre centros en dos capas

Equivale a `q()` + `pf()` de la referencia PHP, pero con una barrera en la base además de la de la app.

1. **Base de datos:** toda tabla de un centro lleva `centro_id` y declara `UNIQUE (centro_id, id)`. Las relaciones entre ellas son claves foráneas compuestas: `turnos (centro_id, paciente_id) → pacientes (centro_id, id)`. PostgreSQL rechaza cualquier fila que mezcle datos de dos centros, sin importar cómo se haya escrito la consulta.
2. **App:** `PrismaService.paraCentro(centroId)` (`backend/src/prisma/centro.ts`) devuelve un cliente que agrega `centro_id` a cada lectura, update y delete, lo completa en cada alta y rechaza pedir, escribir o mover datos de otro centro.

Un test unitario verifica que la lista de modelos filtrados coincida con los modelos del schema que tienen `centroId`. Los tests de integración (`test/aislamiento-centros.e2e-spec.ts`) lo prueban contra PostgreSQL real con dos centros.

Limitaciones conocidas:
- Las consultas SQL crudas (`$queryRaw`) no pasan por el filtro y deben filtrar a mano.
- Más adelante se puede sumar Row Level Security de PostgreSQL como tercera barrera.

## 8. Ajustes al modelo de tablas del prototipo

- **IDs UUID v7** en lugar de enteros: no son enumerables desde la API, se pueden generar en el cliente (útil para la app móvil sin conexión) y siguen ordenados por fecha.
- **`miembros` (centro, usuario, rol)** en lugar de `usuarios.rol`: un mismo usuario puede trabajar en más de un centro con distinto rol. `usuarios.es_superadmin` marca al superadministrador de la plataforma.
- **`profesionales.usuario_id` opcional** y con nombre propio: se puede cargar un profesional antes de darle acceso.
- **`recurrencias`** lleva paciente, profesional y sala, porque sin ellos no se pueden generar los turnos.
- **`periodo` como fecha** (primer día del mes, controlado con un CHECK) en lugar de texto `YYYY-MM`.
- **Reglas en CHECK de la base:** fin posterior a inicio, porcentajes entre 0 y 100, montos no negativos, día de semana entre 1 y 7, email en minúsculas, y vencimiento de CUD solo si el paciente tiene CUD.
- **Precios de los planes en 0** hasta definir la política comercial (`backend/prisma/seed.ts`).

## 9. Autenticación y roles

- **Contraseñas:** scrypt de Node (sin dependencias nativas, que complican Windows y el despliegue). Los parámetros viajan en el hash (`scrypt$N$r$p$salt$hash`), así se pueden endurecer sin invalidar los existentes. Al login se verifica siempre un hash, exista o no el email, para no revelar cuentas por el tiempo de respuesta.
- **Tokens:**
  - **Access token:** JWT HS256 de 15 minutos con usuario, sesión, centro, rol y si es superadmin.
  - **Refresh token:** valor al azar de 30 días, del que en la tabla `sesiones` se guarda solo su SHA-256. Rota en cada uso; si llega uno ya rotado, se asume robo y se cierran todas las sesiones del usuario.
- **Varios centros:** si el usuario tiene un solo centro entra directo; si tiene varios elige después (`POST /auth/centro`). El rol se toma de `miembros` en cada renovación: un cambio de rol o una baja se aplica como mucho a los 15 minutos.
- **Guards:** toda ruta exige token salvo `@Publico()`. `@Roles(...)` exige centro elegido y rol, y `@SoloSuperadmin()` restringe al superadmin, que no ve datos de centros salvo que sea miembro.
- **Límites:** 10 intentos de login por minuto por IP y 300 pedidos por minuto en general (`@nestjs/throttler`).
- **No se usó `@nestjs/authentication` ni `@nestjs/authorization`:** están en versión 0.1, demasiado inmaduras para la base de seguridad. Se usa `@nestjs/jwt` (estable) con guards propios.
- **Frontend:**
  - El access token vive en memoria. El refresh token va en `localStorage`, y en la app móvil irá en el almacenamiento seguro del sistema.
  - Un interceptor renueva la sesión ante un 401 y reintenta; si varios pedidos fallan a la vez, comparten una sola renovación.
  - **Pendiente para producción web:** mover el refresh token a una cookie httpOnly para que un XSS no pueda leerlo.

## 10. ABM de pacientes, profesionales y salas

- **Permisos:**

  | Recurso | Ver | Crear y editar |
  | --- | --- | --- |
  | Salas | todos los roles | admin |
  | Profesionales | todos los roles | admin |
  | Pacientes | admin y recepción ven todos; un profesional, solo los que tiene asignados | admin y recepción |

- **Porcentaje de liquidación:** lo ven solo el admin y el propio profesional.
- **Bajas lógicas:** `activa` o `activo = false`. Nada se borra, porque los turnos, las prestaciones y las liquidaciones guardan referencias.
- **Vínculo profesional ↔ usuario:** un profesional se puede vincular con una cuenta del centro que tenga rol profesional. Es lo que le permite ver sus pacientes.
- **Búsqueda de pacientes:** busca por nombre, apellido, DNI (con o sin puntos) o teléfono, sin importar tildes ni mayúsculas.
  - La columna `pacientes.busqueda` guarda ese texto normalizado y la mantiene la app (`src/common/texto.ts`).
  - Un índice GIN trigram (`pg_trgm`) hace rápidas las búsquedas "contiene".
  - Se eligió así porque `unaccent` de PostgreSQL no se puede usar en índices sin funciones envoltorio y no se integra con Prisma.
- **Errores de base:** un filtro global traduce los errores de Prisma a HTTP: único repetido → 409 con el campo, no encontrado → 404, referencia inválida → 409.
- **Financiadores:** el paciente ya tiene `financiadorId`, pero las obras sociales se gestionan en el paso 7.

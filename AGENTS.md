# AGENTS.md — reglas del proyecto Centro Integral

Para personas y asistentes de IA que trabajen en este repositorio. Son obligatorias.

## Datos y privacidad

1. **Todo se filtra por centro.** Cada dato de un centro lleva `centro_id`, y toda consulta pasa por
   `PrismaService.paraCentro(centroId)` (ver `backend/src/prisma/centro.ts`), que agrega el filtro
   solo. El cliente directo de Prisma es solo para tablas globales (usuarios, planes, centros, sesiones).
   Las relaciones entre tablas de un centro usan claves compuestas `(centro_id, id)`, así un dato no
   puede apuntar a otro centro. Cada módulo nuevo suma su caso al test `aislamiento-centros.e2e-spec.ts`.
2. **Nada de datos de pacientes en los logs.** Ni nombres, DNI, teléfonos, diagnósticos, notas ni
   montos asociados a una persona. Los logs llevan solo ids, códigos de error y conteos. Lo mismo
   para los mensajes de error que devuelve la API y los textos de las excepciones.
3. **Las notas clínicas van cifradas** (AES-256-GCM, `CifradoService`), y también la clave privada de
   ARCA. Nunca se guardan en claro ni se devuelven a quien no corresponde.
4. **Secretos solo en `.env`** (y en las variables del servicio en producción). Nunca en el código, en
   los tests, en `render.yaml` ni en la documentación. `.env` no se sube a git; `.env.example` lleva
   solo nombres y valores de ejemplo.
5. **Sin servicios externos que envíen datos sin autorización.** No se agregan analíticas,
   telemetría, rastreo de errores en la nube, CDN de terceros ni APIs que reciban datos del centro sin
   una decisión explícita del responsable del proyecto, anotada en `docs/decisiones.md`. Hoy los únicos
   externos son ARCA (facturación, solo con el certificado del emisor) y WhatsApp por enlace (lo abre
   el usuario). Las tipografías se sirven desde el propio servidor (`docs/decisiones.md` §18). La telemetría de las herramientas está apagada (`CHECKPOINT_DISABLE`,
   `NG_CLI_ANALYTICS`, `analytics: false` en `angular.json`, `@scarf/scarf` sin scripts de instalación).

## Cambios en el código

- **Migraciones:** nunca se edita una migración ya aplicada; se crea una nueva. Toda migración conserva
  los datos existentes (se migran, no se borran).
- **Permisos en el backend:** rol (`@Roles`) y módulo del plan (`@RequiereModulo`). El frontend oculta
  lo que no corresponde, pero la API es la que bloquea.
- **Tests antes de commitear:** `npm test` y `npm run test:e2e` en `backend`, `npx ng test --watch=false`
  y `npx ng build` en `frontend`. Si algo falla, no se commitea.
- **Idioma:** código, mensajes, comentarios y documentación en español rioplatense.
- **Estado del proyecto:** `docs/estado.md` (lo hecho y lo pendiente), `docs/decisiones.md` (por qué),
  `docs/prototipo.md` (qué debe hacer el sistema).

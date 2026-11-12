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

## 11. Agenda

- **Superposición en la base:** dos restricciones `EXCLUDE USING gist` (con `btree_gist`) sobre `(centro_id, sala_id, tstzrange(inicio, fin))` y `(centro_id, profesional_id, …)`.
  - Los turnos cancelados no cuentan.
  - Los rangos son `[inicio, fin)`: un turno que termina 10:00 no choca con otro que empieza 10:00.
  - Antes de guardar, la app busca los choques para dar un mensaje claro ("La sala Sala 1 está ocupada de 10:00 a 10:45"). La base frena los pedidos simultáneos que pasen ese control (probado en los tests e2e).
- **Zona horaria:** la base guarda instantes en UTC. La API recibe y devuelve fecha (`AAAA-MM-DD`) y hora (`HH:MM`) en la zona del centro (`centros.zona_horaria`), así ningún cliente (web o móvil) tiene que convertir. Las conversiones usan `Temporal`, que viene con Node 26 y respeta los cambios de horario.
- **Turnos semanales:**
  - `POST /recurrencias` crea los turnos libres y devuelve las fechas que chocan, en vez de rechazar todo. Sin fecha de fin, genera 26 semanas.
  - `POST /recurrencias/:id/finalizar` cancela los pendientes desde una fecha.
- **Permisos:**
  - Admin y recepción gestionan todos los turnos.
  - El profesional ve y gestiona solo los suyos, y solo con pacientes que tiene asignados. No puede pasar un turno a otro profesional.
  - Para elegir sala, cualquier rol ve la ocupación sin datos de pacientes (`GET /turnos/ocupacion`).
- **Avisos:**
  - Cada alta, cambio o cancelación hecha por un profesional crea un aviso para cada admin y recepcionista activo del centro (tabla `avisos`, uno por destinatario, con su propio estado de lectura).
  - Los cambios de admin y recepción no avisan.
  - El frontend consulta el contador cada minuto. Más adelante: notificaciones push en la app móvil.
- **Estados:** solo se pueden mover y cancelar turnos pendientes (si ya tiene asistencia, primero se vuelve a pendiente).
- **Zona horaria de la conexión:** el adaptador de Prisma para PostgreSQL manda y lee las fechas `timestamptz` como hora "de pared". Si la base corre en otra zona (una instalación local en Argentina, por ejemplo), cada fecha quedaba corrida tres horas: la app no lo notaba porque el corrimiento iba y volvía, pero sí cualquier consulta directa y los `now()` de la base. Toda conexión abre la sesión en UTC ([src/prisma/adaptador.ts](../backend/src/prisma/adaptador.ts)). Render corre en UTC, así que producción no estaba afectada.

## 12. Asistencia y notas de sesión (paso 6)

- **Quién marca la asistencia:** admin y recepción, cualquier turno; el profesional, solo los suyos (decisión del usuario). `POST /turnos/:id/asistencia` con `presente`, `ausente_con_aviso`, `ausente_sin_aviso` o `pendiente` (para corregir). La cancelación sigue por `/cancelar`.
- **Cuándo:** "presente" y "ausente sin aviso", desde que empieza el turno; "ausente con aviso" también antes, porque el aviso llega antes de la sesión.
- **Correcciones:** se puede cambiar hasta que se cierre el mes, es decir, mientras la liquidación de ese profesional para ese mes no esté `cerrada` o `pagada` (paso 8). Después responde 409.
- **Registro:** cada cambio (incluida la cancelación) queda en `cambios_asistencia`: estado anterior, nuevo, quién y cuándo (`GET /turnos/:id/asistencia/cambios`).
- **Historial y planilla:** `GET /pacientes/:id/asistencia` (resumen y turnos) y `GET /pacientes/:id/planilla?mes=AAAA-MM` (fechas del mes sin los cancelados, con financiador y n.º de afiliado). El profesional ve solo sus turnos. La planilla se imprime desde el navegador, con columnas para firmar.
- **Pacientes compartidos:** un paciente puede tener varios profesionales (`paciente_profesional`, desde el paso 4). Lo que se comparte entre ellos son las notas.
- **Notas de sesión:**
  - Son del profesional que las escribe. Privadas por defecto; si las comparte, las leen los demás profesionales que atienden al paciente.
  - Admin y recepción no acceden a notas clínicas (403). Un profesional que no atiende al paciente recibe 404.
  - Solo el autor edita la suya. No se borran.
- **Cifrado** ([src/notas/cifrado.ts](../backend/src/notas/cifrado.ts), portado de `crypto.php`):
  - AES-256-GCM. Cada centro tiene su clave de datos (32 bytes al azar), creada con la primera nota y guardada en `centros.clave_datos`, cifrada con la clave maestra `DATOS_CLAVE_MAESTRA`, que vive fuera de la base.
  - Con un volcado de la base no alcanza para leer las notas.
  - Cada texto se cifra atado a su centro, paciente y autor: copiado a otra fila, no se descifra.
  - **Si se pierde o se cambia `DATOS_CLAVE_MAESTRA`, las notas guardadas quedan ilegibles.** Hay que guardarla aparte (en Render la genera el Blueprint).
  - Diferencia con la referencia PHP: allá la clave era por profesional; acá es por centro, porque las notas se comparten entre profesionales del mismo centro.

## 13. Obras sociales y financiadores (paso 7)

- **Una tabla genérica** (`financiadores`) en lugar de casos fijos como OSEP: cada centro carga las suyas, de tipo obra social, prepaga, CUD o particular. Un paciente sin financiador se atiende como particular.
- **Reglas en columnas** (como pide el prototipo): código de prestación, si cada sesión necesita orden, si necesita token, cuántas sesiones por semana cubre y cuántos días vale una orden. Se usan en el paso 8 (órdenes, tokens y facturación); por ahora la ficha avisa cuando una semana tiene más sesiones de las cubiertas.
- **No bloquea la agenda:** pasarse del máximo semanal es un aviso, no un error, porque el centro puede atender igual (como particular o con otra orden).
- **Baja lógica:** una obra social dada de baja no se puede asignar a pacientes nuevos, pero los que ya la tienen la siguen mostrando.
- **CUD:** sigue siendo un dato del paciente (sí/no y vencimiento). La ficha avisa 30 días antes de que venza y cuando está vencido.

## 14. Cobros y liquidación (paso 8)

- **Prestación = sesión que se cobra.** Se crea en la misma transacción que marca "presente" y se borra si la asistencia se corrige. No se puede sacar de presente una sesión con pagos o marcada como presentada (409): primero se deshace eso en Cobros. Las prestaciones guardan paciente, profesional, fecha y mes copiados del turno, para filtrar y liquidar sin pasar por turnos.
- **Solo "presente" genera cobro.** En la referencia PHP un faltazo sin aviso de un particular también se cobraba; acá queda pendiente de decidir (puede ser una regla por centro).
- **Cobertura:** la del paciente al marcar presente. Sin obra social es particular (`financiador_id` null, sin fila "Particular" en la tabla). Se puede cambiar en la sesión mientras no tenga pagos.
- **Valor de la sesión con historial** (como `precios.php`): tabla `precios` por cobertura, con precio especial opcional por paciente. Gana el especial del paciente para esa cobertura; si no, el general. Un precio nuevo no pisa el anterior: rige desde su fecha. Al cargarlo o borrarlo se recalculan las sesiones desde esa fecha que no tengan pagos ni estén presentadas, con monto automático y de meses sin liquidar. El monto se puede poner a mano en una sesión (y volver al automático). Sin precio, la sesión vale 0 y aparece en "Para revisar".
- **Órdenes:** tabla `ordenes` (número, emisión, vencimiento, sesiones). El vencimiento sale de los días de validez de la obra social (el día de emisión cuenta) y se puede corregir. Una sesión presente toma la orden vigente más vieja con lugar; una orden nueva se asigna a las sesiones que la esperaban. Una orden con sesiones no se borra ni baja su cupo por debajo de lo usado.
- **Token:** un dato de cada sesión (en mayúsculas). Leerlo de la credencial con la cámara, como en la referencia, queda para más adelante.
- **Pagos:** monto, fecha, medio y estado. "Cobrado" suma; "pendiente" (cheque o transferencia sin acreditar) reserva saldo pero no cuenta como cobrado; "rechazado" no suma (débito de la obra social). No se puede pagar más que el saldo. Cobrar en lote paga el saldo de cada sesión elegida.
- **Estado de cobro** (calculado, no guardado): cobrada, pago parcial, rechazada o por cobrar.
- **Conciliación:** por profesional, turnos presentes contra sesiones registradas, presentadas y cobradas, y la lista de lo que no cierra: presente sin registrar (datos de antes del módulo; "Registrarlas" las crea), sin precio, falta orden u orden fuera de fecha, falta token, sin presentar a la obra social, presentada sin cobrar, rechazada o impaga.
- **Liquidación:** base = lo facturado del mes (las sesiones presentes valorizadas), no lo cobrado, porque las obras sociales pagan meses después y el profesional no debería esperar ese pago. Lo del profesional = base × su porcentaje, redondeado al centavo; el resto es la retención del centro. *Esto contradice el comentario original del schema ("de lo cobrado"); si se prefiere liquidar sobre lo cobrado, es un cambio chico en `LiquidacionesService.calcular`.*
- **Ciclo:** "Generar" crea las sesiones que falten, guarda los totales y deja la liquidación **cerrada**: desde ahí no cambian la asistencia ni los montos de ese mes para ese profesional (los pagos y los tokens sí). No se genera con turnos del mes sin marcar. Cerrada → "Marcar pagada" (definitivo) o "Reabrir" (vuelve a borrador y se recalcula en vivo). Un cambio de porcentaje posterior no toca lo ya cerrado.
- **Permisos:** admin y recepción ven y gestionan cobros y órdenes; el valor de la sesión lo carga el admin (recepción lo ve). Liquidaciones: el admin todas; el profesional solo la suya; recepción no. El profesional ve sus sesiones sin acciones.
- **Montos:** `Decimal` de Prisma para sumar (sin errores de punto flotante); la API devuelve números.

## 15. Planes y módulos (paso 9)

- **Dónde se controla:** `@RequiereModulo(Modulo.x)` en cada controller (o ruta). El AuthGuard, después del rol, consulta los módulos del plan del centro y responde 403 "El plan del centro no incluye …". Una caché de 30 segundos evita ir a la base en cada pedido; se limpia al cambiar un plan o el plan de un centro.
- **Qué controla cada módulo:** agenda (turnos y semanales), asistencia (historial y planilla), pacientes (pacientes y notas), cobros (sesiones, pagos, resumen, precios), liquidación, obras sociales (órdenes, presentación y el alta o edición de obras sociales; la lista se sigue leyendo porque la usa la ficha) y facturación electrónica. Marcar asistencia sigue creando la sesión para cobrar aunque el plan no tenga cobros: si el centro cambia de plan, los datos ya están.
- **Frontend:** la sesión trae `centro.plan` y `centro.modulos`; menú, rutas, ficha y panel ocultan lo que no corresponde. La API controla igual.
- **Superadmin:** `/planes` (listar, crear, precio y módulos) y `PATCH /centros/:id` (plan, nombre, baja), con su pantalla.

## 16. Facturación electrónica con ARCA (paso 10)

- **Emisor: el centro o cada profesional.** `config_fiscal` tiene una fila del centro (`profesional_id` null, única por índice parcial) y una por profesional que factura con su CUIT. El centro elige con `factura_cada_profesional`: si está activo, cada profesional carga sus datos y su certificado y emite las facturas de las sesiones que atendió (admin puede hacerlo por él; recepción emite pero no cambia datos fiscales). Cada factura guarda su emisor (`config_fiscal_id`), y la numeración es por emisor. Guía para el profesional: [arca-paso-a-paso.md](arca-paso-a-paso.md).
- **Qué se factura:** Factura C (monotributo) a consumidor final, una por paciente particular y por mes, con las sesiones ya cobradas y sin factura. Sin DNI sale "sin identificar" (tipo 99). Las sesiones de obras sociales no se facturan acá: se presentan.
- **Cliente ARCA en TypeScript** ([src/facturacion/arca.ts](../backend/src/facturacion/arca.ts)), portado de `Arca.php`: WSAA firma el pedido de ticket en CMS con el contenido incluido (`node-forge`; verificado con `openssl cms -verify`) y el ticket (12 h) se guarda y reutiliza; WSFEv1 pide el último número y solicita el CAE. Las conexiones bajan el nivel de TLS (`SECLEVEL=1`) solo para ARCA, como la referencia. El transporte se puede reemplazar: así se prueba sin red.
- **Modos:** simulado (no llama a ARCA; numeración propia y CAE ficticio), homologación y producción. Fuera de producción el PDF dice "SIN VALIDEZ FISCAL".
- **Certificado:** el sistema genera la clave privada y el pedido (CSR); la clave se guarda **cifrada con la clave de datos del centro** (como las notas) y nunca sale. Al cargar el certificado se controla que corresponda a esa clave.
- **Después de emitir:** las sesiones quedan atadas a la factura y marcadas como presentadas; no cambian monto, cobertura ni asistencia. Una factura rechazada queda registrada con el motivo y sus sesiones vuelven a "para facturar". Si ARCA no responde, la emisión corta ahí.
- **PDF** con el formato habitual y el QR de la RG 4291 (`pdfkit` y `qrcode`).

## 17. Presentación a obras sociales (paso 10)

- **Generalizado:** lo que la referencia hacía para OSEP sirve para cualquier obra social, con sus reglas de la tabla `financiadores`.
- **Fecha a declarar** (`prestaciones.fecha_declarada`): sugerida con las reglas de `sugerir_fechas_osep` (no antes de la emisión de la orden, una por día, de lunes a sábado, hasta el máximo semanal y antes del vencimiento, dentro del mes). Se completa con un botón y se puede corregir a mano.
- **Órdenes:** una orden nueva cubre también las sesiones de su mes anteriores a la emisión (en OSEP la orden se compra después y esas sesiones se declaran con fecha posterior). El aviso "orden fuera de fecha" mira la fecha declarada si la hay.
- **Tokens:** se pegan como texto (token y n.º de afiliado o DNI por línea) y se emparejan como `emparejar_tokens`: por afiliado, si no por DNI; un token repetido se descarta. Primero se revisa y después se guarda. Leerlos de las capturas con OCR queda para más adelante.
- **Presentada:** la misma marca `facturada` de la sesión, que ya usaban Cobros y la conciliación.


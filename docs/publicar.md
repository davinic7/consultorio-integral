# Publicar en Render

Con esto el sistema queda en una dirección pública (por ejemplo `https://centro-integral.onrender.com`) que se abre desde cualquier navegador, celular incluido, y se actualiza solo con cada push a `main`.

## Cómo está armado

- **Un solo servicio web:** una imagen Docker ([Dockerfile](../Dockerfile)) donde la API (NestJS) sirve también la web (Angular). Web y API comparten dominio: no hace falta configurar CORS.
- **Una base PostgreSQL 17** administrada por Render.
- **Arranque** ([backend/scripts/arrancar.sh](../backend/scripts/arrancar.sh)): en cada inicio aplica las migraciones, carga los planes y, si están configurados, crea el superadmin y los datos demo. Es idempotente.
- **Configuración** en [render.yaml](../render.yaml) (Blueprint de Render).

## Plan gratis: qué tener en cuenta

- El servicio **se duerme tras 15 minutos sin uso**. La primera visita después tarda cerca de un minuto en responder.
- **La base gratis vence a los 30 días** de creada; después hay 14 días para pasarla a un plan pago antes de que se borre. Sirve para mostrar el prototipo, no para datos reales.
- Para uso real: plan pago en el servicio y en la base (con backups). Respaldo, restauración y qué hacer cuando vence: [respaldo-base.md](respaldo-base.md).

## Pasos (los hacés vos en render.com)

1. **Crear la cuenta** en https://render.com (se puede entrar con GitHub).
2. **Dar acceso al repositorio:** en Render, *New* → *Blueprint* → conectar GitHub y elegir `davinic7/consultorio-integral`.
3. **Revisar el Blueprint:** Render lee `render.yaml` y muestra lo que va a crear: el servicio `centro-integral` y la base `centro-integral-db`, ambos en plan *Free*.
4. **Completar las variables que pide:**

   | Variable | Qué poner |
   | --- | --- |
   | `SUPERADMIN_EMAIL` | Tu email, para entrar como superadmin |
   | `SUPERADMIN_PASSWORD` | Una contraseña tuya, de al menos 10 caracteres |
   | `DEMO_PASSWORD` | Contraseña de los usuarios demo, de al menos 10 caracteres (distinta de la tuya) |

   `DATABASE_URL`, `JWT_SECRET` y `DATOS_CLAVE_MAESTRA` las completa Render solo. Nada de esto queda en git.
5. **Aplicar** (*Apply*). Render crea la base, construye la imagen (unos minutos la primera vez) y arranca el servicio.
6. **Abrir la dirección** que muestra Render (`https://centro-integral….onrender.com`).

Con `CARGAR_DEMO=true` (así viene en `render.yaml`) quedan los mismos usuarios demo que en tu máquina (`admin@demo.local`, `recepcion@demo.local`, `profesional@demo.local`, `superadmin@demo.local`), con la contraseña de `DEMO_PASSWORD`. Cualquiera que conozca esa contraseña puede entrar: compartila solo con quien tenga que probar.

## Después de publicar

- **Actualizaciones:** cada push a `main` vuelve a construir y publicar solo (`autoDeployTrigger: commit`).
- **Ver qué pasa:** en el servicio, pestaña *Logs*. Al arrancar se ven los pasos `→ Migraciones`, `→ Planes`, `→ Superadmin`, `→ Datos demo` y `→ Iniciando la API`.
- **Comprobar que responde:** `https://<tu-dirección>/api/v1/health` debe devolver `{"status":"ok","db":"up"}`.
- **Documentación de la API:** `https://<tu-dirección>/api/docs`.
- **Ambiente real (sin demo):** en *Environment*, poner `CARGAR_DEMO` en `false`. Los usuarios demo que ya existan siguen existiendo hasta que se den de baja.

## La clave de las notas (`DATOS_CLAVE_MAESTRA`)

Las notas de sesión se guardan cifradas, y esta clave es la que permite leerlas. Render la genera una vez y la conserva entre deploys.

- **No cambiarla ni borrarla:** las notas ya guardadas quedarían ilegibles para siempre.
- Copiarla a un lugar seguro, fuera de Render (gestor de contraseñas). Un backup de la base sin esta clave no permite leer las notas.
- Si al actualizar el servicio el deploy falla con "DATOS_CLAVE_MAESTRA: …", agregarla a mano en *Environment* con *Generate* (pasa si el Blueprint no se sincronizó).

## Si algo falla

- **El build falla:** revisar los *Logs* del deploy. El paso que falló aparece arriba del error.
- **Arranca pero health dice `"db":"down"`:** revisar que `DATABASE_URL` venga de la base (en *Environment*, debe decir *from database*).
- **Error con `JWT_SECRET`:** tiene que tener al menos 32 caracteres; el que genera Render cumple.
- **"No se encontró index.html":** el build del frontend no se copió; revisar el paso `npm run build` de `frontend` en los logs.

## Otras plataformas

La misma imagen sirve en **Railway**, **Fly.io** o un **servidor propio** con Docker. Hay que darle:

- `DATABASE_URL`: PostgreSQL 17 con las extensiones `pg_trgm` y `btree_gist` disponibles. Las crean las migraciones; el usuario tiene que ser dueño de la base.
- `JWT_SECRET`: al menos 32 caracteres al azar.
- `DATOS_CLAVE_MAESTRA`: al menos 32 caracteres al azar, y guardada aparte (sin ella no se leen las notas).
- `PORT`: lo define la plataforma; si no, 3000.
- Opcionales: `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD`, `CARGAR_DEMO` y `DEMO_PASSWORD`.

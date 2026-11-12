# Respaldo de la base y vencimiento de la base gratis de Render

La base gratis de Render **vence a los 30 días de creada**. La de Centro Integral se creó el 9/11/2026, así que vence **alrededor del 9 de diciembre de 2026**. Después Render da 14 días para pasarla a un plan pago; pasado ese plazo, **la borra**. Verificá la fecha exacta en el panel de Render (base `centro-integral-db`).

Hay dos caminos. En los dos, **primero se hace un respaldo**.

## 1. Hacer un respaldo (siempre, antes de tocar nada)

Se necesita PostgreSQL 17 instalado en la PC (para `pg_dump`). En esta PC ya está, en `C:\Program Files\PostgreSQL\17\bin`.

1. En Render: base `centro-integral-db` → **Connect** → copiar la **External Database URL**.
2. En una terminal Git Bash, desde la carpeta `backend`:

```bash
RESPALDO_DATABASE_URL='pegar-acá-la-URL-externa' sh scripts/respaldar-base.sh
```

Deja un archivo `centro-integral-AAAA-MM-DD-HHMM.dump` en `~/respaldos-centro-integral` (fuera del repositorio; el script no deja guardarlo adentro). Al final dice cuántas tablas respaldó.

**Cuidado con ese archivo:** tiene los datos personales de los pacientes. Las notas de sesión van cifradas, pero nombres, DNI y teléfonos no. Guardalo en un lugar seguro y no lo subas a ningún servicio sin cifrarlo.

**La clave de las notas:** para leer las notas después de restaurar hace falta la misma `DATOS_CLAVE_MAESTRA` del servicio (Render → servicio `centro-integral` → *Environment*). Guardala en un gestor de contraseñas, **separada** del respaldo.

## 2a. Pasar la base a un plan pago (lo más simple)

En Render: base `centro-integral-db` → **Upgrade** → elegir un plan pago. La base sigue siendo la misma: no cambia la URL, no hay que restaurar nada y el servicio sigue andando. Los planes pagos de Render incluyen respaldos automáticos (revisá en el panel cuántos días guarda el plan que elijas).

Es lo recomendado si ya hay datos que importan.

## 2b. Pasar los datos a una base nueva

Sirve para cambiar de proveedor o de región, o para empezar otra base gratis mientras se muestra el prototipo (otra vez vence a los 30 días: no sirve para datos reales).

1. Crear la base nueva (PostgreSQL 17) y copiar su URL externa.
2. Restaurar el respaldo **en la base nueva, vacía**:

```bash
RESTAURAR_DATABASE_URL='URL-de-la-base-nueva' sh scripts/restaurar-base.sh ~/respaldos-centro-integral/centro-integral-AAAA-MM-DD-HHMM.dump
```

El script se niega a restaurar en una base que ya tiene tablas, para no pisar nada. Al terminar muestra cuántos centros y pacientes quedaron.

3. En el servicio `centro-integral` → *Environment*: cambiar `DATABASE_URL` por la URL **interna** de la base nueva. `DATOS_CLAVE_MAESTRA` y `JWT_SECRET` quedan igual.
4. El servicio se reinicia solo. Al arrancar aplica las migraciones que falten. Comprobar en `/api/v1/health` que diga `"db":"up"` y entrar a la app.

## Mientras tanto

Hasta decidir, conviene hacer un respaldo por semana (o antes de cada publicación con migraciones) con el paso 1.

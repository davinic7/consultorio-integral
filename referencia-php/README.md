# Consultorio: gestión para psicólogos

Sistema web en PHP 8 y MySQL/MariaDB, sin framework ni Composer, pensado para usar desde el celular. Automatiza lo que surgió del relevamiento con una psicóloga de Catamarca:

| Módulo | Qué resuelve |
|---|---|
| **Agenda** | Turnos fijos semanales, agenda del mes generada sola y marcado rápido de cada sesión: ✔ asistió · ✘$ no vino y avisó tarde (cobra) · ✘ avisó con tiempo (no cobra). Registro de pago en efectivo o por transferencia. |
| **Pacientes** | Ficha con DNI y domicilio (los datos que pide la factura), datos personales, precio por paciente con historial y aumento gradual por grupos (30→35, 35→38…). Al dar de baja a un paciente se liberan sus turnos futuros. |
| **Facturación** | Arma sola la lista del mes (sesiones cobrables y pagadas) y emite la **Factura C** por el web service de ARCA (WSFE): consumidor final, DNI, servicios, período del mes anterior y vencimiento al día. Genera el PDF con QR y CAE, lo nombra "Apellido Nombre", lo guarda en `storage/facturas/emitidas-AAAA-MM/` y desde el celular se comparte por WhatsApp con el PDF adjunto. Lleva la cuenta de las facturas enviadas, igual que la lista en papel. |
| **OSEP** | Registro de la orden con foto, número de autorización y fecha de compra. Sugiere las fechas a declarar respetando las reglas: una por día, ninguna antes de la compra, dentro del mes y como máximo N por semana. Tiene un asistente con botones para copiar los datos al SIA, guarda los tokens y marca las sesiones cargadas. Para los mayores sin token, imprime la planilla para firmar. También arma los mensajes de WhatsApp para pedir la orden y los tokens. |
| **Notas por dictado** | Al terminar la sesión se dictan 2 o 3 minutos (no se graba la sesión). El texto se puede corregir y se guarda **cifrado** (AES-256-GCM) en la ficha del paciente. |
| **Inicio** | Muestra las tareas del mes: sesiones sin marcar, la facturación pendiente, las órdenes de OSEP que faltan y el aviso de fin de mes con las cargas pendientes. |

## Instalación (Windows con Herd o XAMPP, o un hosting)

1. Copiar la carpeta. El **document root** tiene que ser `public/`. En Herd: `herd link consultorio` dentro de la carpeta.
2. Crear la base y el usuario:
   ```
   php database/instalar.php
   ```
   Pregunta los datos de MySQL, crea `config.php` con una clave de cifrado aleatoria, arma las tablas y crea el usuario.
   Para probar con datos ficticios: `php database/instalar.php --sqlite --demo` (usuario `demo`, contraseña `demo1234`) y después `php -S localhost:8000 -t public`.
3. **Hacer una copia de `config.php`**. Ahí está la `app_key`: si se pierde, no se pueden leer las notas clínicas.
4. Entrar → **Ajustes** → completar los datos de la profesional, la facturación y OSEP.

Requisitos: PHP 8.1 o superior con las extensiones pdo_mysql, openssl, curl, gd y mbstring. FPDF y phpqrcode ya vienen incluidas en `lib/`, y Bootstrap en `public/assets/vendor/`.

## Varios profesionales

Cada profesional tiene su cuenta y ve sólo sus datos: todas las tablas llevan `profesional_id` y `q()` rechaza cualquier consulta sobre datos de pacientes que no filtre por profesional (`pf()`). Cada uno tiene su carpeta `storage/pN/` y su propia clave para cifrar las notas (guardada cifrada con la `app_key`).

- **Administrador**: `php database/instalar.php --admin` crea el usuario que da de alta, desactiva y resetea contraseñas de los profesionales (pantalla *Profesionales*). No ve datos de pacientes.
- **Facturación por delegación**: el administrador carga el CUIT y el certificado del proveedor en *Profesionales*; cada profesional delega el servicio *Facturación Electrónica* a ese CUIT desde ARCA y no necesita certificado propio. Sigue existiendo la opción de certificado propio (Ajustes → Conexión con ARCA).
- **Actualizar una instalación anterior**: `php database/migrar.php` (o `instalar.php`, que la detecta). Pasa todo al profesional 1, vuelve a cifrar las notas y mueve los archivos a `storage/p1/`. En SQLite deja una copia de la base; en MySQL hacé un mysqldump antes.

## Habilitar la facturación real en ARCA (se hace una sola vez)

1. **Ajustes → Generar pedido (CSR)**: descarga `pedido_arca.csr`. La clave privada queda en `storage/certs/`.
2. En ARCA, con clave fiscal: *Administración de Certificados Digitales* → crear un alias → subir el `.csr` → descargar el `.crt`.
3. En ARCA: *Administrador de Relaciones de Clave Fiscal* → Nueva relación → **Facturación Electrónica (wsfe)** → asignarla al alias del certificado.
4. En ARCA: *Administración de Puntos de Venta* → agregar un punto de venta **"RECE para aplicativo y web services"**. El que se usa en "Comprobantes en línea" **no sirve** para el web service.
5. **Ajustes → Subir .crt**, poner el punto de venta nuevo, elegir modo **Homologación** o **Producción** y tocar **Probar conexión**.

Mientras tanto, el modo **Simulado** permite usar todo el sistema. Los PDF que genera llevan la marca "SIN VALIDEZ FISCAL".

> Para homologación ARCA pide un certificado aparte, generado en *WSASS* (el autoservicio de homologación) con el mismo CSR.

## Seguridad y datos de salud

- Las notas clínicas son datos sensibles (Ley 25.326 y Ley 26.529). Se guardan cifradas y sólo se ven con la sesión iniciada.
- Usar **HTTPS**: el dictado por voz del navegador lo exige y protege la contraseña. En Herd: `herd secure`.
- Los PDF, las fotos de órdenes y los certificados quedan en `storage/`, que no es accesible desde la web: los archivos se sirven sólo a través del sistema.
- Hacer una copia periódica de la base (mysqldump), de `storage/` y de `config.php`.

## Estructura

```
public/          index.php (rutas), assets/ (css, js, Bootstrap)
app/pages/       una página por pantalla
app/lib/         db, reglas del consultorio, ARCA (WSAA + WSFE), PDF, cifrado
database/        schema.sql, instalar.php, demo.php
storage/         facturas/, ordenes/, planillas/, certs/, cache/
lib/             fpdf, phpqrcode
```

## Pendiente o para la próxima etapa

- **Carga automática en el SIA de OSEP**: hoy el asistente deja todo listo para copiar y pegar. Para automatizar el llenado (con un userscript o un robot de navegador) hace falta ver el HTML del formulario del SIA con una cuenta real.
- Leer la foto de la orden y completar los datos sola (OCR o IA).
- Confirmar con OSEP la edad desde la que no se pide token y si hay tope mensual de sesiones.
- Centros integrales: varios usuarios dentro de una misma cuenta, con pacientes compartidos.

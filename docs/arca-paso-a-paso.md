# ARCA paso a paso: de cero a la primera factura de prueba

Guía para un profesional que nunca facturó electrónicamente. Primero se prueba en
**homologación** (el ambiente de pruebas de ARCA: las facturas no tienen validez fiscal
y no hay riesgo), y recién después se pasa a **producción**.

> La clave fiscal se usa solamente en la web de ARCA. El sistema nunca la pide ni la
> guarda: guarda un certificado y su clave privada (cifrada), que sirven solo para
> facturar.
>
> Los nombres de los menús de ARCA cambian cada tanto. Si algo no coincide, buscá el
> servicio por el nombre que figura entre comillas.

## Antes de empezar

- **Clave fiscal nivel 3** en ARCA. Si tenés nivel 2, se sube con validación biométrica
  desde la app "Mi ARCA" o en una dependencia.
- En el sistema, la administración del centro tiene que activar en **Facturación →
  Datos fiscales** la opción *"Cada profesional factura sus sesiones particulares con
  su propio CUIT"*. Si trabajás solo, sos el admin de tu espacio: la activás vos.
- Para **probar** no hace falta estar inscripto en el monotributo. Para **facturar de
  verdad**, sí (la Factura C es la de los monotributistas).

## 1. Habilitar el servicio de certificados de prueba (una sola vez)

1. Entrá a [arca.gob.ar](https://www.arca.gob.ar) con tu CUIT y tu clave fiscal.
2. Buscá el servicio **"Administrador de Relaciones de Clave Fiscal"**.
3. Tocá **"Adherir servicio"** → ARCA → Servicios interactivos →
   **"WSASS - Autogestión Certificados Homologación"** → Confirmar.
4. Salí y volvé a entrar: el servicio WSASS aparece en tu lista.

## 2. Cargar tus datos y generar el pedido de certificado (en el sistema)

1. **Facturación → Datos fiscales**.
2. Completá **CUIT**, **razón social** (tu nombre y apellido si sos monotributista) y
   **domicilio**. En **Modo** elegí **Homologación**. Punto de venta: dejá **1**.
3. Tocá **Guardar**.
4. Tocá **"Generar pedido de certificado"**. Se descarga el archivo
   `pedido-arca.csr`. Abrilo con el Bloc de notas: es un texto que empieza con
   `-----BEGIN CERTIFICATE REQUEST-----`.

## 3. Obtener el certificado de prueba (en ARCA, servicio WSASS)

1. Entrá a **"WSASS - Autogestión Certificados Homologación"**.
2. **"Nuevo certificado"**:
   - *Nombre simbólico del DN*: un alias sin espacios, por ejemplo `centrointegral`.
   - *Solicitud de certificado en formato PKCS#10*: pegá todo el texto de
     `pedido-arca.csr` (incluidas las líneas BEGIN y END).
   - Tocá **"Crear DN y obtener certificado"**.
3. ARCA muestra el certificado (`-----BEGIN CERTIFICATE-----` …). Copialo entero.
4. Ahora **"Crear autorización a servicio"**:
   - *Nombre simbólico del DN a autorizar*: el alias de antes (`centrointegral`).
   - *CUIT representada*: tu CUIT.
   - *Servicio*: **wsfe - Facturación Electrónica**.
   - Tocá **"Crear autorización de acceso"**.

## 4. Cargar el certificado y probar (en el sistema)

1. **Facturación → Datos fiscales → Certificado de ARCA**: pegá el certificado en el
   cuadro (o subí el archivo) y tocá **"Guardar certificado"**. Si dice que no
   corresponde a la clave, el certificado es de otro pedido: repetí desde el paso 2.4.
2. Tocá **"Probar conexión"**. Tiene que responder algo como *"AppServer OK, DbServer
   OK, AuthServer OK. Última Factura C del punto de venta 1: 0"*.

## 5. Emitir una factura de prueba

1. Registrá un turno de un paciente **particular** (sin obra social) con **DNI**,
   marcá la asistencia como **presente** y registrá el **pago** de la sesión.
2. **Facturación**, elegí el mes de la sesión → pestaña **Para facturar** → tildá el
   paciente → **"Emitir facturas elegidas"**.
3. En **Emitidas** aparece con su número y su **CAE** real de homologación. El PDF
   dice que no tiene validez fiscal.

Listo: la conexión con ARCA funciona con tus datos.

## 6. Pasar a producción (cuando estés inscripto en el monotributo)

Lo mismo, con el ambiente real:

1. **Punto de venta**: en ARCA, **"Administración de puntos de venta y domicilios"** →
   agregar uno nuevo del tipo **"Factura Electrónica - Monotributo - Web Services"**
   (o "RECE para aplicativo y web services"). Anotá el número.
2. **Certificado**: en el sistema, poné el número de punto de venta, cambiá el modo a
   **Producción**, guardá y generá un **pedido nuevo** (el de homologación no sirve).
   En ARCA, servicio **"Administración de Certificados Digitales"** → agregar alias →
   subir `pedido-arca.csr` → descargar el certificado y cargarlo en el sistema.
3. **Autorización**: en **"Administrador de Relaciones de Clave Fiscal"** → "Nueva
   relación" → ARCA → WebServices → **"Facturación Electrónica"** → como
   representante, elegí el alias del certificado.
4. **"Probar conexión"** y, desde ahí, las facturas tienen validez fiscal.

## Problemas comunes

| Mensaje | Qué hacer |
| --- | --- |
| *No se pudo autenticar con ARCA* / `cms.cert.untrusted` | El certificado es de otro ambiente: el de homologación no sirve en producción ni al revés. |
| `ns1:coe.notAuthorized` | Falta la autorización al servicio `wsfe` (paso 3.4 o 6.3). |
| *El certificado no corresponde a la clave generada acá* | Se generó otro pedido después; repetí el pedido y el certificado. |
| Error 10016 / punto de venta | En producción, el punto de venta tiene que ser del tipo web services. |
| El paciente no aparece en "Para facturar" | Tiene que ser particular, con la sesión presente y **pagada**. Sin DNI se factura a consumidor final. |

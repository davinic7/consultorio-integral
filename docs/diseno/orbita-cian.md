# Órbita Cian — guía de diseño para implementar

Sistema visual de Centro Integral. Esta guía es para quien implemente el rediseño en el frontend Angular (una persona o Claude Code). Explica qué hay, cómo conectarlo y en qué orden migrar.

- **Lienzo de diseño (fuente de verdad visual):** https://claude.ai/artifact/KStzQ3W9zqcv3FA8eoDCsm — página **Pantallas** (las 6 pantallas + celular) y página **Futurista** (sistema, modo claro y marca).
- **Código de referencia de cada pantalla:** `docs/diseno/referencia/*.dc.html`. Son los archivos del lienzo: HTML con estilos en línea y la lógica de cada pantalla en el `<script>` del final. Sirven para copiar medidas, colores y comportamiento exactos. No se pueden abrir sueltos en el navegador. Las imágenes que aparecen como `/_blob/...` son el sello DaviNic, que en la app está en `/marca/davinic-sello.png`.
- **Estilos listos:** `frontend/src/styles/_orbita.scss` (variables y clases con prefijo `oc-`).
- **Marca:** `frontend/public/marca/` (`isotipo-oscuro.svg`, `isotipo-claro.svg`, `favicon.svg`, `davinic-sello.png`).

## Personalidad

Fondo oscuro profundo, una grilla técnica tenue, paneles de vidrio y un cian que brilla como un nodo de red. Es futurista pero calmo, porque es un sistema de salud. El brillo cian **solo marca lo vivo**: la hora actual, lo seleccionado y la acción principal. Nunca es decoración.

El tema oscuro es el principal. El claro tiene la misma estructura: fondo hielo, superficies blancas y cian profundo (`#0E7490`) para el texto de acento.

## Reglas de marca (no negociables)

1. **Logo de Centro Integral:** anillo abierto + núcleo cian + satélite en la abertura, con el texto "**Centro** Integral" (Centro en 600, Integral en 300). Va arriba del menú lateral y en el login. En la app, usarlo como SVG en línea (ver snippet) para que cambie con el tema.
2. **Sello DaviNic:** un **globo chico** (36 px) con el **logo original plateado** (`davinic-sello.png`), recortado para que se vea solo el isotipo. Va abajo de todo en el menú lateral, junto a la versión, y en la esquina inferior derecha del login. Al pasar el mouse crece y muestra "Desarrollado por DaviNic Developer".
   - **No** usar franjas al pie ni textos "Desarrollado por" fijos.
   - **No** usar el isotipo vectorial redibujado de DaviNic.
3. La acción principal es **siempre** un botón cian `#22D3EE` con texto `#04121A`, en los dos temas.

## Cómo conectarlo (una vez)

1. **Fuentes:** Sora y JetBrains Mono se sirven desde el propio servidor, sin Google Fonts
   (`docs/decisiones.md` §18). Los archivos están en `frontend/public/fuentes/` y se declaran en
   `frontend/src/styles/_fuentes.scss`. En `frontend/src/index.html`, dentro de `<head>`, solo va
   la precarga de la principal y el ícono:
   ```html
   <link rel="preload" href="fuentes/sora-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
   <link rel="icon" type="image/svg+xml" href="marca/favicon.svg" />
   ```
2. **Estilos:** primeras líneas de `frontend/src/styles.scss`:
   ```scss
   @use "styles/fuentes";
   @use "styles/orbita";
   ```
   Las clases `oc-*` conviven con las actuales (`.boton`, `.tarjeta`…). Migrar pantalla por pantalla y borrar las clases viejas cuando ya nadie las use.
3. **Fondo:** poner `class="oc-app"` en `<body>`.
4. **Tema:** crear `core/tema.service.ts`. Guarda la elección en `localStorage` y la aplica como atributo en `<html>`. Sin elección guardada sigue al dispositivo.
   ```ts
   @Injectable({ providedIn: "root" })
   export class TemaService {
     private readonly clave = "ci-tema";
     readonly tema = signal<"claro" | "oscuro" | null>(this.leer());
     constructor() {
       effect(() => {
         const t = this.tema();
         const html = document.documentElement;
         t
           ? html.setAttribute("data-tema", t)
           : html.removeAttribute("data-tema");
         try {
           t
             ? localStorage.setItem(this.clave, t)
             : localStorage.removeItem(this.clave);
         } catch {}
       });
     }
     esOscuro(): boolean {
       return this.tema()
         ? this.tema() === "oscuro"
         : !matchMedia("(prefers-color-scheme: light)").matches;
     }
     alternar(): void {
       this.tema.set(this.esOscuro() ? "claro" : "oscuro");
     }
     private leer() {
       try {
         return localStorage.getItem(this.clave) as "claro" | "oscuro" | null;
       } catch {
         return null;
       }
     }
   }
   ```
   Botón en la barra superior: `aria-label="Cambiar a modo claro"` o `"Cambiar a modo oscuro"`. Ícono de sol en oscuro y de luna en claro.

## Tokens

Todos están en `_orbita.scss` como `--oc-*`, con valores para oscuro y claro.

| Grupo       | Variables                                                                                 | Oscuro → Claro                                                        |
| ----------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Fondo       | `fondo`, `grilla`, `brillo`, `brillo-2`                                                   | `#05080F` → `#F3F7FC`; grilla de 48 px                                |
| Superficies | `lateral`, `panel`, `tarjeta`, `campo`                                                    | vidrio translúcido → blanco                                           |
| Bordes      | `borde`, `borde-suave`                                                                    | `rgba(148,197,255,.12)` → `#DCE6F2`                                   |
| Texto       | `texto`, `texto-medio`, `texto-suave`                                                     | `#E8F1FF` / `#C9D6EA` / `#8FA3BF` → `#0B1726` / `#2A3B52` / `#4A5B73` |
| Acento      | `acento`, `acento-texto`, `acento-fondo`, `acento-borde`, `acento-fuerte`, `sobre-acento` | cian `#22D3EE`; en claro el texto de acento es `#0E7490`              |
| Estados     | `ok-*`, `aviso-*`, `error-*`, `azul-*` (justificada)                                      | cada uno con color, texto, fondo y borde                              |
| Disciplinas | `psi-*`, `to-*`, `fono-*`, `psicoped-*`                                                   | cian, azul, lila y ámbar                                              |
| Forma       | `radio-chico` 8, `radio` 12, `radio-tarjeta` 16, `radio-panel` 18, `radio-hero` 24        |                                                                       |
| Tipografía  | `t-display`, `t-titulo`, `t-subtitulo`, `t-cuerpo`, `t-chico`, `t-etiqueta`, `t-dato`     | Sora para textos; JetBrains Mono para horas, montos y etiquetas       |

**Contraste verificado (AA):** texto suave sobre fondo 7,4:1 en oscuro y 6,9:1 en claro. Botón cian con texto oscuro, 11:1. Acento `#0E7490` sobre blanco, 5,4:1.

## Componentes → clases

| Componente          | Clase                                                                               | Notas                                                |
| ------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Estructura          | `.oc-shell` > `.oc-nav` + `.oc-principal` > `.oc-barra` + `.oc-contenido`           | flex con `wrap`: en celular el menú pasa arriba solo |
| Ítem del menú       | `.oc-nav__item` + `routerLinkActive="activo"`                                       |                                                      |
| Logo                | `.oc-marca` + `.oc-marca__iso`                                                      |                                                      |
| Sello               | `.oc-globo` > `.oc-globo__recorte` > `img`                                          |                                                      |
| Botones             | `.oc-btn`, `--primario`, `--fantasma`, `--peligro`, `--chico`, `--icono`            | alto mínimo 46 px (44 en chicos)                     |
| Campos              | `.oc-campo` (label que envuelve input/select/textarea), `.oc-check`, `.oc-buscador` | foco con anillo cian                                 |
| Día/Semana, filtros | `.oc-segmentado` con `aria-pressed`                                                 |                                                      |
| Pestañas            | `.oc-pestanas` con `aria-selected` o `.activo`                                      |                                                      |
| Tarjetas            | `.oc-tarjeta`, `--interactiva`, `--destacada`                                       |                                                      |
| Indicadores         | `.oc-indicadores` > `.oc-tarjeta` con `.oc-kpi__titulo` / `.oc-kpi__valor`          | grilla `auto-fit` de 220 px                          |
| Tablas              | `.oc-tabla-caja` > `.oc-tabla`                                                      | la caja hace scroll horizontal en celular            |
| Estado              | `.oc-estado--ok` / `--aviso` / `--error` / `--info` / `--atendido`                  | siempre con texto, nunca solo color                  |
| Alertas             | `.oc-alerta`, `--ok` / `--aviso` / `--error`                                        | con ícono                                            |
| Turno en agenda     | `.oc-turno--psi` / `--to` / `--fono` / `--psicoped`, `--en-curso`, `--ausente`      |                                                      |
| En vivo             | `.oc-vivo`, `.oc-ahora`                                                             |                                                      |

**Íconos:** de línea, 1,5 px de trazo, `stroke="currentColor"`, 17 px en el menú y 16 en botones. Los SVG exactos están en los archivos de referencia; si se prefiere una librería, Lucide tiene los mismos (layout-dashboard, calendar, square-check, users, wallet, bar-chart, search, bell, sun, moon).

**Gráficos:** sin librería. Son SVG simples, copiables de la referencia:

- anillo con `stroke-dasharray` sobre una circunferencia de 113,1;
- línea con `polyline` y `drop-shadow`;
- barras con `div` y el ancho en porcentaje;
- barra segmentada con `flex`.

## Pantallas

| Pantalla               | Ruta Angular                                    | Referencia           | Qué tiene que hacer                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------- | ----------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Login                  | `/login` (existe)                               | `Login.dc.html`      | Dos columnas que se apilan en celular: a la izquierda la marca con la órbita girando (60 s por vuelta), a la derecha el formulario. Mostrar/ocultar contraseña, "Recordarme", globo DaviNic en la esquina.                                                                                                                                                                                                     |
| Panel principal        | `/` → `inicio` (existe)                         | `Panel.dc.html`      | 4 indicadores (turnos, asistencias con anillo, cobrado con línea, por cobrar), salas en tiempo real con la línea de la hora actual, próximo turno, pendientes de cobro, asistencia por profesional y avisos.                                                                                                                                                                                                   |
| Agenda                 | `/agenda` (existe)                              | `Agenda.dc.html`     | Vistas Día y Semana. En Día, columnas por sala o por profesional (selector). Hora de 08 a 14 con 72 px por hora en Día y 56 en Semana. En Semana, los turnos que se pisan se reparten en carriles. Filtro de profesionales con casillas, calendario chico del mes y aviso de sala libre. La validación de superposición que ya existe sigue igual; solo cambia cómo se ve.                                     |
| Registro de asistencia | **nueva** (`/asistencia`) o dentro de la agenda | `Asistencia.dc.html` | Lista del día con botones grandes "Llegó", "Ausente" y "Justificada". Tocar de nuevo el botón activo vuelve el turno a "Por llegar". Pestañas con contadores (Todos, Por llegar, Llegaron, Ausentes) y anillo de % que se actualizan al instante. Usar el módulo `backend/src/asistencia` y `core/asistencia.ts`.                                                                                              |
| Ficha del paciente     | `/pacientes/:id` (existe)                       | `Ficha.dc.html`      | Encabezado con avatar del color de la disciplina, chips (edad, disciplina, obra social, estado) y acciones (WhatsApp, Nuevo turno). Indicadores: orden de la obra social, asistencia sesión por sesión, próximo turno y saldo. Pestañas Resumen, Sesiones, Notas y Pagos; las notas ya existen en `notas-paciente.ts`.                                                                                         |
| Cobros y liquidación   | **nueva** (`/cobros`)                           | `Cobros.dc.html`     | Selector de período, 4 indicadores y dos secciones. En Cobros: tabla con filtros y botón "Cobrar" por fila, más gráficos por medio de pago y por día. En Liquidación: barras de facturación por profesional y una tarjeta por profesional con sesiones, facturado, retención del centro y "Generar liquidación". El porcentaje de retención sale de la configuración de cada profesional; en el diseño es 30%. |
| Celular                | todas                                           | `Celular.dc.html`    | Con menos de 768 px el menú lateral pasa a una **barra inferior** de 5 íconos (Panel, Agenda, Asistencia, Cobros y Más). Botón flotante "+" para nuevo turno en la agenda. Tarjetas en vez de tablas donde se pueda.                                                                                                                                                                                           |

Las pantallas de Profesionales, Salas, Avisos, Pacientes (lista), Planilla y Elegir centro no tienen diseño propio. Usan la misma estructura con `.oc-tarjeta`, `.oc-tabla` y `.oc-campo`.

## Responsive y accesibilidad

- El ancho manda, no el dispositivo. Usar `flex-wrap`, `grid` con `auto-fit` y `minmax`, y `clamp()` en títulos y márgenes. Las tablas y la agenda van dentro de una caja con `overflow-x: auto`.
- Todo lo que se toca mide 44 px o más. En celular, los botones de asistencia miden 48 px.
- Usar elementos reales: `<button>`, `<a routerLink>`, `<label>` envolviendo cada campo. Los botones que son solo un ícono llevan `aria-label`.
- Los estados nunca se marcan solo con color: siempre van con texto, y el ausente además con borde punteado y rayado.
- Respetar `prefers-reduced-motion`; `_orbita.scss` ya apaga las animaciones en ese caso.
- Movimiento: al pasar el mouse, 150–200 ms con elevación de 1–2 px. Lo que está en vivo late cada 2 s.

## Orden sugerido de migración

Cada paso en su propio commit:

1. Conectar fuentes, estilos, `oc-app` y `TemaService`.
2. Shell: menú lateral con logo y sello, barra superior con buscador, botón de tema y avatar, y barra inferior en celular.
3. Login.
4. Panel principal (inicio).
5. Agenda.
6. Ficha del paciente.
7. Registro de asistencia (ruta nueva).
8. Cobros y liquidación (ruta nueva; necesita los endpoints de cobros en el backend).
9. Pantallas sin diseño propio con las clases `oc-*`. Al final, borrar los estilos viejos de `styles.scss`.

## Snippets

**Logo (SVG en línea, cambia con el tema):**

```html
<a routerLink="/" class="oc-marca">
  <svg
    class="oc-marca__iso"
    width="32"
    height="32"
    viewBox="0 0 48 48"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="ci-anillo" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" style="stop-color: var(--oc-marca-anillo-1)" />
        <stop offset="1" style="stop-color: var(--oc-marca-anillo-2)" />
      </linearGradient>
    </defs>
    <path
      d="M37.79 12.43 A18 18 0 1 0 37.79 35.57"
      fill="none"
      stroke="url(#ci-anillo)"
      stroke-width="4"
      stroke-linecap="round"
    />
    <path
      d="M24 24 H40"
      stroke="var(--oc-acento)"
      stroke-width="2"
      stroke-linecap="round"
      opacity=".7"
    />
    <circle cx="24" cy="24" r="5" fill="var(--oc-acento)" />
    <circle cx="42" cy="24" r="3" fill="var(--oc-marca-satelite)" />
  </svg>
  <span><b>Centro</b> <span>Integral</span></span>
</a>
```

**Sello DaviNic:**

```html
<a
  class="oc-globo"
  href="https://wa.me/[NÚMERO]"
  target="_blank"
  rel="noopener"
  title="Desarrollado por DaviNic Developer"
  aria-label="Desarrollado por DaviNic Developer"
>
  <span class="oc-globo__recorte"
    ><img src="marca/davinic-sello.png" alt=""
  /></span>
</a>
```

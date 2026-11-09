import { Component, input } from '@angular/core';

let siguiente = 0;

/**
 * Isotipo de Centro Integral (anillo abierto + núcleo cian + satélite), en línea
 * para que cambie con el tema. Cada copia usa su propio id de degradado: si una
 * está oculta, las demás se siguen viendo.
 */
@Component({
  selector: 'app-isotipo',
  host: { style: 'display: inline-flex' },
  template: `
    <svg
      class="oc-marca__iso"
      [attr.width]="tam()"
      [attr.height]="tam()"
      viewBox="0 0 48 48"
      aria-hidden="true"
    >
      <defs>
        <linearGradient [attr.id]="id" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style="stop-color: var(--oc-marca-anillo-1)" />
          <stop offset="1" style="stop-color: var(--oc-marca-anillo-2)" />
        </linearGradient>
      </defs>
      <path
        d="M37.79 12.43 A18 18 0 1 0 37.79 35.57"
        fill="none"
        [attr.stroke]="'url(#' + id + ')'"
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
  `,
})
export class Isotipo {
  readonly tam = input(32);
  protected readonly id = `ci-anillo-${++siguiente}`;
}

/** WhatsApp de DaviNic (formato wa.me de celular argentino: 54 9 + área + número). */
export const CONTACTO_DAVINIC = 'https://wa.me/5493834277003';

/** Sello DaviNic: globo chico con el logo original plateado, recortado al isotipo. */
@Component({
  selector: 'app-sello-davinic',
  host: { style: 'display: inline-flex' },
  template: `
    <a
      class="oc-globo"
      [href]="contacto"
      target="_blank"
      rel="noopener"
      title="Desarrollado por DaviNic Developer"
      aria-label="Desarrollado por DaviNic Developer (abre WhatsApp)"
    >
      <span class="oc-globo__recorte"><img src="marca/davinic-sello.png" alt="" /></span>
    </a>
  `,
})
export class SelloDavinic {
  protected readonly contacto = CONTACTO_DAVINIC;
}

import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DictadoService } from '../../core/dictado/dictado.service';
import { mmss } from '../paciente-ficha/dictado-panel';

/**
 * Píldora de la barra superior mientras hay un dictado en curso o grabaciones sin
 * enviar (docs/diseno/expediente-dictado.md). Lleva al expediente del paciente.
 * Grabando: cian, punto que titila, texto y tiempo; nunca solo el color.
 */
@Component({
  selector: 'app-pildora-dictado',
  imports: [RouterLink],
  template: `
    @if (vista(); as v) {
      @if (v.pacienteId) {
        <a
          class="pil"
          [class.pil--vivo]="v.vivo"
          [class.pil--aviso]="v.aviso"
          [routerLink]="['/pacientes', v.pacienteId]"
          [queryParams]="{ pestana: 'expediente' }"
          [attr.aria-label]="v.etiqueta"
          [title]="v.etiqueta"
        >
          <span class="pil__punto" aria-hidden="true"></span>
          <span aria-hidden="true">{{ v.texto }}</span>
        </a>
      } @else {
        <span class="pil pil--aviso" role="status" [title]="v.etiqueta">
          <span class="pil__punto" aria-hidden="true"></span>
          {{ v.texto }}
        </span>
      }
    }
  `,
  styles: `
    @keyframes titila {
      50% {
        opacity: 0.3;
      }
    }
    .pil {
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      min-height: 2.25rem;
      padding: 0 0.875rem;
      border: 1px solid var(--oc-acento-borde);
      border-radius: 999px;
      background: var(--oc-acento-fondo);
      color: var(--oc-acento-fuerte);
      font: 600 0.75rem var(--oc-fuente-mono);
      letter-spacing: 0.06em;
      text-decoration: none;
      white-space: nowrap;
    }
    .pil--vivo {
      border-color: var(--oc-acento);
      background: var(--oc-acento);
      color: var(--oc-sobre-acento);
      box-shadow: 0 0 22px var(--oc-brillo-acento, rgba(34, 211, 238, 0.45));
    }
    .pil--aviso {
      border-color: var(--oc-aviso-borde);
      background: var(--oc-aviso-fondo);
      color: var(--oc-aviso-texto);
    }
    .pil__punto {
      width: 0.5rem;
      height: 0.5rem;
      border-radius: 999px;
      background: currentColor;
    }
    .pil--vivo .pil__punto {
      animation: titila 1.4s ease-in-out infinite;
    }
    @media (prefers-reduced-motion: reduce) {
      .pil--vivo .pil__punto {
        animation: none;
      }
    }
  `,
})
export class PildoraDictado {
  private readonly d = inject(DictadoService);

  protected readonly vista = computed(() => {
    const fase = this.d.fase();
    const paciente = this.d.paciente();
    const nombre = paciente?.nombre ? ` de ${paciente.nombre}` : '';
    const id = paciente?.id ?? null;
    switch (fase) {
      case 'grabando':
      case 'pausado':
        return {
          pacienteId: id,
          vivo: fase === 'grabando',
          aviso: false,
          texto: `${fase === 'grabando' ? 'GRABANDO' : 'EN PAUSA'} · ${mmss(this.d.segundos())}`,
          etiqueta: `Dictado${nombre}: ${fase === 'grabando' ? 'grabando' : 'en pausa'}. Ir al expediente`,
        };
      case 'enviando':
        return {
          pacienteId: id,
          vivo: false,
          aviso: false,
          texto: `ENVIANDO · ${Math.round(this.d.subida() * 100)} %`,
          etiqueta: `Dictado${nombre}: enviando la grabación. Ir al expediente`,
        };
      case 'transcribiendo': {
        const t = this.d.trabajo();
        const pct = t?.duracionSeg ? Math.round((t.procesadoSeg / t.duracionSeg) * 100) : 0;
        return {
          pacienteId: id,
          vivo: false,
          aviso: false,
          texto: `TRANSCRIBIENDO · ${pct} %`,
          etiqueta: `Dictado${nombre}: transcribiendo. Ir al expediente`,
        };
      }
      case 'error':
        return {
          pacienteId: id,
          vivo: false,
          aviso: true,
          texto: 'DICTADO CON ERROR',
          etiqueta: `El dictado${nombre} no se pudo transcribir. Ir al expediente`,
        };
    }
    const n = this.d.pendientes().length;
    if (!n) return null;
    return {
      pacienteId: fase === 'sin_conexion' ? id : null,
      vivo: false,
      aviso: true,
      texto: `${n} SIN ENVIAR`,
      etiqueta: `${n} ${n === 1 ? 'dictado espera' : 'dictados esperan'} señal para transcribirse`,
    };
  });
}

import { Component, computed, inject, input, output } from '@angular/core';
import { AVISO_SEGUNDOS, DictadoService, MAX_SEGUNDOS } from '../../core/dictado/dictado.service';
import { local } from '../../core/expediente';

/** "02:47" */
export function mmss(segundos: number): string {
  const s = Math.max(0, Math.round(segundos));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Forma de las barras de nivel: se multiplican por la voz del momento. */
const FORMA = [0.35, 0.6, 0.9, 0.5, 1, 0.7, 0.4, 0.85, 0.55, 0.95, 0.45, 0.75, 0.6, 0.9, 0.5, 0.8];
/** Circunferencia del anillo de tiempo (r = 104). */
const CIRCUNFERENCIA = 2 * Math.PI * 104;

/**
 * Estados del dictado en pantalla (docs/diseno/expediente-dictado.md, tabla 3). Lee
 * todo del DictadoService; las decisiones que cierran el panel las toma el panel de
 * nueva evolución.
 */
@Component({
  selector: 'app-dictado-panel',
  templateUrl: './dictado-panel.html',
  styleUrl: './dictado-panel.scss',
})
export class DictadoPanel {
  /** Zona del centro, para la hora de las grabaciones pendientes. */
  readonly zona = input.required<string>();

  /** Prefiere escribir (o pasar a escribir mientras tanto). */
  readonly escribir = output<void>();
  /** Volver al expediente (la transcripción o la cola siguen solas). */
  readonly volver = output<void>();
  /** Pidió descartar lo que está grabando: lo confirma el panel. */
  readonly descartar = output<void>();

  protected readonly d = inject(DictadoService);
  protected readonly maximo = mmss(MAX_SEGUNDOS);

  protected readonly grabando = computed(() => this.d.fase() === 'grabando');
  protected readonly enGrabacion = computed(() => this.grabando() || this.d.fase() === 'pausado');
  protected readonly tiempo = computed(() => mmss(this.d.segundos()));
  protected readonly resta = computed(() => `quedan ${mmss(MAX_SEGUNDOS - this.d.segundos())}`);
  protected readonly casi = computed(() => this.d.segundos() >= AVISO_SEGUNDOS);
  /** Trazo del anillo de tiempo hacia los 10 minutos. */
  protected readonly trazo = computed(() => {
    const hecho = (Math.min(this.d.segundos(), MAX_SEGUNDOS) / MAX_SEGUNDOS) * CIRCUNFERENCIA;
    return `${hecho} ${CIRCUNFERENCIA}`;
  });
  protected readonly escalaVoz = computed(() => 1 + this.d.nivel() * 0.22);
  protected readonly barras = computed(() => {
    const nivel = this.grabando() ? this.d.nivel() : 0;
    return FORMA.map((f) => Math.round(4 + nivel * f * 40));
  });

  protected readonly subida = computed(() => Math.round(this.d.subida() * 100));
  protected readonly progreso = computed(() => {
    const t = this.d.trabajo();
    if (!t || !t.duracionSeg) return { porcentaje: 0, texto: '', antes: 0 };
    return {
      porcentaje: Math.round((t.procesadoSeg / t.duracionSeg) * 100),
      texto: `${mmss(t.procesadoSeg)} de ${mmss(t.duracionSeg)}`,
      antes: t.antes,
    };
  });
  protected readonly duracion = computed(() => mmss(this.d.trabajo()?.duracionSeg ?? 0));

  protected readonly pendientes = computed(() =>
    this.d.pendientes().map((p) => ({
      id: p.id,
      quien: p.pacienteId === this.d.paciente()?.id ? this.d.paciente()!.nombre : 'Otro paciente',
      detalle: `${local(p.creadoEn, this.zona()).hora} · ${mmss(p.duracionSeg)} de audio`,
      error: p.intentos >= 3,
    })),
  );
}

import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { mensajeDeError, ReportesApi } from '../../core/api/api';
import type { Reporte } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { nombreMes, plata, sumarMes } from '../../core/cobros';
import { hoyEn } from '../../core/fechas';

const MESES_CORTOS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sep',
  'oct',
  'nov',
  'dic',
];

/** "2026-11" → "nov 26". */
export function mesCorto(mes: string): string {
  const [a, m] = mes.split('-');
  return `${MESES_CORTOS[Number(m) - 1]} ${a.slice(2)}`;
}

/** Alto de cada barra en % del máximo (mínimo visible si el valor no es cero). */
export function alturas(valores: number[]): number[] {
  const max = Math.max(...valores, 0);
  return valores.map((v) => (max ? Math.max((v / max) * 100, v ? 2 : 0) : 0));
}

interface Barra {
  mes: string;
  etiqueta: string;
  valor: number;
  texto: string;
  alto: number;
}

/**
 * Reportes del centro (módulo "reportes"): por rango de meses, sesiones y asistencia,
 * lo facturado y lo cobrado, por profesional y por cobertura. Un profesional ve solo
 * lo suyo.
 */
@Component({
  selector: 'app-reportes',
  templateUrl: './reportes.html',
  styleUrl: './reportes.scss',
})
export class Reportes {
  private readonly api = inject(ReportesApi);
  private readonly auth = inject(AuthService);

  protected readonly plata = plata;
  protected readonly nombreMes = nombreMes;
  protected readonly opciones = [3, 6, 12] as const;
  protected readonly cantidad = signal<number>(6);
  protected readonly reporte = signal<Reporte | null>(null);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);

  /** El rango termina en el mes actual. */
  private readonly hasta = computed(() =>
    hoyEn(this.auth.sesion()?.centro?.zonaHoraria).slice(0, 7),
  );
  private readonly desde = computed(() => sumarMes(this.hasta(), -(this.cantidad() - 1)));
  protected readonly rango = computed(
    () => `${nombreMes(this.desde())} a ${nombreMes(this.hasta())}`,
  );

  protected readonly barrasSesiones = computed(() => this.barras((m) => m.presentes, String));
  protected readonly barrasFacturado = computed(() => this.barras((m) => m.facturado, plata));

  constructor() {
    effect(() => {
      const desde = this.desde();
      const hasta = this.hasta();
      untracked(() => void this.cargar(desde, hasta));
    });
  }

  protected elegir(n: number): void {
    this.cantidad.set(n);
  }

  protected porcentaje(n: number | null): string {
    return n === null ? '—' : `${n}%`;
  }

  private barras(
    valor: (m: Reporte['meses'][number]) => number,
    formato: (n: number) => string,
  ): Barra[] {
    const meses = this.reporte()?.meses ?? [];
    const valores = meses.map(valor);
    const altos = alturas(valores);
    return meses.map((m, i) => ({
      mes: m.mes,
      etiqueta: mesCorto(m.mes),
      valor: valores[i]!,
      texto: formato(valores[i]!),
      alto: altos[i]!,
    }));
  }

  private async cargar(desde: string, hasta: string): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const r = await this.api.reporte(desde, hasta);
      if (desde === this.desde()) this.reporte.set(r);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo armar el reporte.'));
    } finally {
      this.cargando.set(false);
    }
  }
}

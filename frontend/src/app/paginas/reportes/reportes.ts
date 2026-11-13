import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { mensajeDeError, ReportesApi } from '../../core/api/api';
import type { Reporte } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { nombreMes, plata, sumarMes } from '../../core/cobros';
import { descargarExcel, type Celda, type Hoja } from '../../core/excel';
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

const pct = (n: number | null): Celda => ({
  valor: n === null ? null : n / 100,
  formato: 'porcentaje',
});
const pesos = (valor: number): Celda => ({ valor, formato: 'plata' });

/** Las hojas del Excel del reporte: las mismas tablas que se ven en pantalla. */
export function hojasDeReporte(r: Reporte): Hoja[] {
  const t = r.total;
  const resumen: Hoja = {
    nombre: 'Resumen',
    columnas: [
      { titulo: 'Dato', ancho: 28 },
      { titulo: 'Valor', formato: 'entero', ancho: 26 },
    ],
    filas: [
      ['Período', `${nombreMes(r.desde)} a ${nombreMes(r.hasta)}`],
      ['Turnos', t.turnos],
      ['Sesiones atendidas', t.presentes],
      ['Faltas con aviso', t.ausentesConAviso],
      ['Faltas sin aviso', t.ausentesSinAviso],
      ['Cancelados por el profesional', t.cancelados],
      ['Sin marcar', t.pendientes],
      ['Asistencia', pct(t.asistencia)],
      ['Facturado', pesos(t.facturado)],
      ['Cobrado', pesos(t.cobrado)],
      ['Falta cobrar', pesos(t.facturado - t.cobrado)],
      ['Pacientes atendidos', t.pacientes],
      ...(t.pacientesNuevos === null ? [] : [['Pacientes nuevos', t.pacientesNuevos]]),
    ],
  };
  const porMes: Hoja = {
    nombre: 'Por mes',
    columnas: [
      { titulo: 'Mes', ancho: 18 },
      { titulo: 'Turnos', formato: 'entero' },
      { titulo: 'Atendidas', formato: 'entero' },
      { titulo: 'Faltas con aviso', formato: 'entero' },
      { titulo: 'Faltas sin aviso', formato: 'entero' },
      { titulo: 'Asistencia', formato: 'porcentaje' },
      { titulo: 'Pacientes', formato: 'entero' },
      { titulo: 'Facturado', formato: 'plata' },
      { titulo: 'Cobrado', formato: 'plata' },
    ],
    filas: r.meses.map((m) => [
      nombreMes(m.mes),
      m.turnos,
      m.presentes,
      m.ausentesConAviso,
      m.ausentesSinAviso,
      pct(m.asistencia),
      m.pacientes,
      m.facturado,
      m.cobrado,
    ]),
    total: [
      'Total',
      t.turnos,
      t.presentes,
      t.ausentesConAviso,
      t.ausentesSinAviso,
      pct(t.asistencia),
      t.pacientes,
      t.facturado,
      t.cobrado,
    ],
  };
  const porProfesional: Hoja = {
    nombre: 'Por profesional',
    columnas: [
      { titulo: 'Profesional' },
      { titulo: 'Disciplina', ancho: 22 },
      { titulo: 'Turnos', formato: 'entero' },
      { titulo: 'Atendidas', formato: 'entero' },
      { titulo: 'Faltas con aviso', formato: 'entero' },
      { titulo: 'Faltas sin aviso', formato: 'entero' },
      { titulo: 'Asistencia', formato: 'porcentaje' },
      { titulo: 'Facturado', formato: 'plata' },
      { titulo: 'Cobrado', formato: 'plata' },
    ],
    filas: r.porProfesional.map((p) => [
      `${p.profesional.apellido}, ${p.profesional.nombre}`,
      p.profesional.disciplina,
      p.turnos,
      p.presentes,
      p.ausentesConAviso,
      p.ausentesSinAviso,
      pct(p.asistencia),
      p.facturado,
      p.cobrado,
    ]),
  };
  const porCobertura: Hoja = {
    nombre: 'Por cobertura',
    columnas: [
      { titulo: 'Cobertura' },
      { titulo: 'Sesiones', formato: 'entero' },
      { titulo: 'Facturado', formato: 'plata' },
    ],
    filas: r.porCobertura.map((c) => [
      c.financiador?.nombre ?? 'Particular',
      c.sesiones,
      c.facturado,
    ]),
  };
  return [resumen, porMes, ...(r.soloProfesional ? [] : [porProfesional]), porCobertura];
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

  /** Baja lo que se está viendo, por ejemplo "reporte-2026-06-a-2026-11.xlsx". */
  protected descargar(): void {
    const r = this.reporte();
    if (r) descargarExcel(`reporte-${r.desde}-a-${r.hasta}`, hojasDeReporte(r));
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

import { Injectable } from '@nestjs/common';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { aFechaSolo } from '../common/comunes.js';
import { aLocal, periodoDe } from '../common/tiempo.js';
import { EstadoPago, MedioPago } from '../generated/prisma/client.js';
import type { ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { alcanceDe, INCLUDE_PRESTACION } from './comun.js';
import { LiquidacionesService } from './liquidaciones.js';
import { PrestacionesService } from './prestaciones.service.js';
import {
  CERO,
  num,
  sumar,
  type AvisoPrestacion,
  type Decimal,
} from './reglas.js';

/**
 * Números del mes para la pantalla de Cobros y el panel, y la conciliación:
 * sesiones asistidas contra lo facturado y lo cobrado.
 */
@Injectable()
export class CobrosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly prestaciones: PrestacionesService,
    private readonly liquidaciones: LiquidacionesService,
  ) {}

  async resumen(centroId: string, quien: UsuarioAutenticado, mes: string) {
    const db = this.db(centroId);
    const alcance = await alcanceDe(db, quien);
    const [filas, totales] = await Promise.all([
      db.prestacion.findMany({
        where: { ...alcance, periodo: periodoDe(mes), anuladaEn: null },
        select: { monto: true, pagos: true },
      }),
      this.liquidaciones.calcular(db, centroId, mes, alcance),
    ]);

    let cobrado = CERO;
    let porCobrar = CERO;
    let porCobrarSesiones = 0;
    const porMedio = new Map<MedioPago, Decimal>();
    const porDia = new Map<string, Decimal>();
    for (const p of filas) {
      const cobrados = p.pagos.filter((x) => x.estado === EstadoPago.cobrado);
      const suyo = sumar(cobrados.map((x) => x.monto));
      cobrado = cobrado.plus(suyo);
      const saldo = p.monto.minus(suyo);
      if (saldo.gt(0)) {
        porCobrar = porCobrar.plus(saldo);
        porCobrarSesiones++;
      }
      for (const x of cobrados) {
        porMedio.set(x.medio, (porMedio.get(x.medio) ?? CERO).plus(x.monto));
        const f = aFechaSolo(x.fecha)!;
        porDia.set(f, (porDia.get(f) ?? CERO).plus(x.monto));
      }
    }
    const facturado = sumar(filas.map((p) => p.monto));
    const alquiler = sumar(totales.map((t) => t.alquiler));
    const saldoProfesionales = sumar(totales.map((t) => t.saldo));
    return {
      mes,
      sesiones: filas.length,
      facturado: num(facturado),
      cobrado: num(cobrado),
      porCobrar: num(porCobrar),
      porCobrarSesiones,
      /** Lo que los profesionales le deben al centro por alquiler. */
      alquiler: num(alquiler),
      /** Suma de los saldos: lo que el centro les paga (menos lo que le deben). */
      saldoProfesionales: num(saldoProfesionales),
      cobradoPorMedio: Object.values(MedioPago)
        .map((medio) => ({ medio, monto: num(porMedio.get(medio) ?? CERO) }))
        .filter((m) => m.monto > 0),
      cobradoPorDia: [...porDia.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fecha, monto]) => ({ fecha, monto: num(monto) })),
      porProfesional: totales.map((t) => ({
        profesional: t.profesional,
        sesiones: t.sesiones,
        facturado: num(t.bruto),
      })),
    };
  }

  /**
   * Conciliación del mes: por profesional, turnos presentes contra prestaciones,
   * facturadas y cobradas; y la lista de lo que no cierra (sin prestación, sin
   * precio, falta orden o token, sin facturar, facturada sin cobrar, rechazada,
   * impaga).
   */
  async conciliacion(centroId: string, quien: UsuarioAutenticado, mes: string) {
    const db = this.db(centroId);
    const [zona, alcance] = await Promise.all([
      this.prestaciones.zona(centroId),
      alcanceDe(db, quien),
    ]);
    const [filas, sinPrestacion] = await Promise.all([
      db.prestacion.findMany({
        where: { ...alcance, periodo: periodoDe(mes), anuladaEn: null },
        include: INCLUDE_PRESTACION,
        orderBy: [{ fecha: 'asc' }, { turno: { inicio: 'asc' } }],
      }),
      this.prestaciones.presentesSinPrestacion(db, mes, zona, alcance),
    ]);
    const vistas = await this.prestaciones.vistas(db, filas, zona);

    type Fila = {
      profesional: (typeof vistas)[number]['profesional'];
      presentes: number;
      prestaciones: number;
      facturadas: number;
      cobradas: number;
      facturado: Decimal;
      cobrado: Decimal;
    };
    const porProfesional = new Map<string, Fila>();
    const fila = (prof: Fila['profesional']) => {
      let f = porProfesional.get(prof.id);
      if (!f) {
        f = {
          profesional: prof,
          presentes: 0,
          prestaciones: 0,
          facturadas: 0,
          cobradas: 0,
          facturado: CERO,
          cobrado: CERO,
        };
        porProfesional.set(prof.id, f);
      }
      return f;
    };
    for (const [i, v] of vistas.entries()) {
      const f = fila(v.profesional);
      // Un faltazo se cobra, pero no es una sesión presente.
      if (v.tipo === 'sesion') f.presentes++;
      f.prestaciones++;
      if (v.facturada) f.facturadas++;
      if (v.estadoCobro === 'cobrada') f.cobradas++;
      f.facturado = f.facturado.plus(filas[i].monto);
      f.cobrado = f.cobrado.plus(v.cobrado);
    }
    for (const t of sinPrestacion) fila(t.profesional).presentes++;

    const conteo: Partial<Record<AvisoPrestacion | 'sin_prestacion', number>> =
      {};
    const sumarAviso = (a: AvisoPrestacion | 'sin_prestacion') =>
      (conteo[a] = (conteo[a] ?? 0) + 1);
    const diferencias = vistas.filter((v) => v.avisos.length);
    for (const v of diferencias) v.avisos.forEach(sumarAviso);
    sinPrestacion.forEach(() => sumarAviso('sin_prestacion'));

    return {
      mes,
      porProfesional: [...porProfesional.values()]
        .sort((a, b) =>
          a.profesional.apellido.localeCompare(b.profesional.apellido),
        )
        .map((f) => ({
          ...f,
          facturado: num(f.facturado),
          cobrado: num(f.cobrado),
        })),
      conteo,
      sinPrestacion: sinPrestacion.map((t) => {
        const ini = aLocal(t.inicio, zona);
        return {
          turnoId: t.id,
          fecha: ini.fecha,
          hora: ini.hora,
          paciente: t.paciente,
          profesional: t.profesional,
        };
      }),
      diferencias,
    };
  }

  private db(centroId: string): ClienteDeCentro {
    return this.prisma.paraCentro(centroId);
  }
}

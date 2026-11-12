import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { UsuarioAutenticado } from '../auth/auth.types.js';
import { CentroActual, Roles, UsuarioActual } from '../auth/decoradores.js';
import { cobroDe, num, sumar } from '../cobros/reglas.js';
import {
  aLocal,
  diasDelMes,
  mesTexto,
  periodoDe,
  rangoDeFechas,
} from '../common/tiempo.js';
import { EstadoAsistencia, Modulo, Rol } from '../generated/prisma/client.js';
import { RequiereModulo } from '../planes/planes.js';
import type { ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';

export const reporteSchema = z
  .object({ desde: mesTexto, hasta: mesTexto })
  .refine((d) => d.desde <= d.hasta, 'desde: tiene que ser anterior a hasta');
export type ReporteDto = z.infer<typeof reporteSchema>;

const MAX_MESES = 24;

/** Meses "AAAA-MM" de desde a hasta, inclusive. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const meses: string[] = [];
  let m = Temporal.PlainYearMonth.from(desde);
  const fin = Temporal.PlainYearMonth.from(hasta);
  while (Temporal.PlainYearMonth.compare(m, fin) <= 0) {
    meses.push(m.toString());
    m = m.add({ months: 1 });
  }
  return meses;
}

/** Presentes sobre los turnos que tenían que ocurrir (sin cancelados ni pendientes). */
export function porcentajeAsistencia(c: {
  presentes: number;
  ausentesConAviso: number;
  ausentesSinAviso: number;
}): number | null {
  const base = c.presentes + c.ausentesConAviso + c.ausentesSinAviso;
  return base ? Math.round((c.presentes / base) * 100) : null;
}

interface Conteo {
  turnos: number;
  presentes: number;
  ausentesConAviso: number;
  ausentesSinAviso: number;
  cancelados: number;
  pendientes: number;
}

const conteoVacio = (): Conteo => ({
  turnos: 0,
  presentes: 0,
  ausentesConAviso: 0,
  ausentesSinAviso: 0,
  cancelados: 0,
  pendientes: 0,
});

function contar(c: Conteo, estado: EstadoAsistencia) {
  c.turnos++;
  if (estado === EstadoAsistencia.presente) c.presentes++;
  else if (estado === EstadoAsistencia.ausente_con_aviso) c.ausentesConAviso++;
  else if (estado === EstadoAsistencia.ausente_sin_aviso) c.ausentesSinAviso++;
  else if (estado === EstadoAsistencia.cancelado_profesional) c.cancelados++;
  else c.pendientes++;
}

/**
 * Reportes del centro por rango de meses: turnos y asistencia, lo facturado (valor de
 * las sesiones) y lo cobrado, por mes, por profesional y por cobertura, y pacientes
 * atendidos y nuevos. Un profesional ve solo lo suyo.
 */
@Injectable()
export class ReportesService {
  constructor(private readonly prisma: PrismaService) {}

  async reporte(centroId: string, quien: UsuarioAutenticado, dto: ReporteDto) {
    const meses = mesesEntre(dto.desde, dto.hasta);
    if (meses.length > MAX_MESES)
      throw new BadRequestException(`hasta: como máximo ${MAX_MESES} meses`);
    const db = this.prisma.paraCentro(centroId);
    const { zonaHoraria: zona } = await this.prisma.centro.findUniqueOrThrow({
      where: { id: centroId },
      select: { zonaHoraria: true },
    });
    const profesionalId = await this.alcance(db, quien);
    const filtroProf = profesionalId ? { profesionalId } : {};

    const rango = rangoDeFechas(
      diasDelMes(dto.desde).primero,
      diasDelMes(dto.hasta).ultimo,
      zona,
    );
    // Consultas en serie: son pocas y así no compiten por la conexión.
    const turnos = await db.turno.findMany({
      where: { inicio: { gte: rango.desde, lt: rango.hasta }, ...filtroProf },
      select: {
        inicio: true,
        estadoAsistencia: true,
        pacienteId: true,
        profesionalId: true,
      },
    });
    const prestaciones = await db.prestacion.findMany({
      where: {
        periodo: { gte: periodoDe(dto.desde), lte: periodoDe(dto.hasta) },
        ...filtroProf,
      },
      select: {
        periodo: true,
        monto: true,
        profesionalId: true,
        financiadorId: true,
        pagos: { select: { monto: true, estado: true } },
      },
    });
    const nuevos = profesionalId
      ? null
      : await db.paciente.count({
          where: { creadoEn: { gte: rango.desde, lt: rango.hasta } },
        });
    const profesionales = await db.profesional.findMany({
      where: { id: { in: [...new Set(turnos.map((t) => t.profesionalId))] } },
      select: { id: true, nombre: true, apellido: true, disciplina: true },
    });
    const financiadores = await db.financiador.findMany({
      where: {
        id: {
          in: [
            ...new Set(
              prestaciones.flatMap((p) =>
                p.financiadorId ? [p.financiadorId] : [],
              ),
            ),
          ],
        },
      },
      select: { id: true, nombre: true },
    });

    type Montos = (typeof prestaciones)[number]['monto'][];
    const porMes = new Map(
      meses.map((m) => [
        m,
        {
          conteo: conteoVacio(),
          pacientes: new Set<string>(),
          facturado: [] as Montos,
          cobrado: [] as Montos,
        },
      ]),
    );
    const porProf = new Map<
      string,
      { conteo: Conteo; facturado: Montos; cobrado: Montos }
    >();
    const porCobertura = new Map<
      string | null,
      { sesiones: number; facturado: Montos }
    >();
    const pacientes = new Set<string>();

    for (const t of turnos) {
      const mes = aLocal(t.inicio, zona).fecha.slice(0, 7);
      const g = porMes.get(mes);
      if (!g) continue;
      contar(g.conteo, t.estadoAsistencia);
      const p = porProf.get(t.profesionalId) ?? {
        conteo: conteoVacio(),
        facturado: [],
        cobrado: [],
      };
      porProf.set(t.profesionalId, p);
      contar(p.conteo, t.estadoAsistencia);
      if (t.estadoAsistencia === EstadoAsistencia.presente) {
        g.pacientes.add(t.pacienteId);
        pacientes.add(t.pacienteId);
      }
    }
    for (const pr of prestaciones) {
      const mes = pr.periodo.toISOString().slice(0, 7);
      const { cobrado } = cobroDe(pr.monto, pr.pagos);
      const g = porMes.get(mes);
      g?.facturado.push(pr.monto);
      g?.cobrado.push(cobrado);
      const p = porProf.get(pr.profesionalId) ?? {
        conteo: conteoVacio(),
        facturado: [],
        cobrado: [],
      };
      porProf.set(pr.profesionalId, p);
      p.facturado.push(pr.monto);
      p.cobrado.push(cobrado);
      const c = porCobertura.get(pr.financiadorId) ?? {
        sesiones: 0,
        facturado: [],
      };
      porCobertura.set(pr.financiadorId, c);
      c.sesiones++;
      c.facturado.push(pr.monto);
    }

    const nombreProf = new Map(profesionales.map((p) => [p.id, p]));
    const faltantes = [...porProf.keys()].filter((id) => !nombreProf.has(id));
    if (faltantes.length) {
      for (const p of await db.profesional.findMany({
        where: { id: { in: faltantes } },
        select: { id: true, nombre: true, apellido: true, disciplina: true },
      }))
        nombreProf.set(p.id, p);
    }
    const nombreFin = new Map(financiadores.map((f) => [f.id, f.nombre]));

    const mesesSalida = meses.map((mes) => {
      const g = porMes.get(mes)!;
      return {
        mes,
        ...g.conteo,
        asistencia: porcentajeAsistencia(g.conteo),
        pacientes: g.pacientes.size,
        facturado: num(sumar(g.facturado)),
        cobrado: num(sumar(g.cobrado)),
      };
    });
    const total = mesesSalida.reduce(
      (a, m) => {
        a.turnos += m.turnos;
        a.presentes += m.presentes;
        a.ausentesConAviso += m.ausentesConAviso;
        a.ausentesSinAviso += m.ausentesSinAviso;
        a.cancelados += m.cancelados;
        a.pendientes += m.pendientes;
        a.facturado += m.facturado;
        a.cobrado += m.cobrado;
        return a;
      },
      { ...conteoVacio(), facturado: 0, cobrado: 0 },
    );

    return {
      desde: dto.desde,
      hasta: dto.hasta,
      soloProfesional: !!profesionalId,
      total: {
        ...total,
        facturado: Math.round(total.facturado * 100) / 100,
        cobrado: Math.round(total.cobrado * 100) / 100,
        asistencia: porcentajeAsistencia(total),
        pacientes: pacientes.size,
        pacientesNuevos: nuevos,
      },
      meses: mesesSalida,
      porProfesional: [...porProf.entries()]
        .map(([id, p]) => ({
          profesional: nombreProf.get(id) ?? {
            id,
            nombre: '',
            apellido: '(sin datos)',
            disciplina: '',
          },
          ...p.conteo,
          asistencia: porcentajeAsistencia(p.conteo),
          facturado: num(sumar(p.facturado)),
          cobrado: num(sumar(p.cobrado)),
        }))
        .sort((a, b) => b.facturado - a.facturado || b.presentes - a.presentes),
      porCobertura: [...porCobertura.entries()]
        .map(([id, c]) => ({
          financiador: id
            ? { id, nombre: nombreFin.get(id) ?? '(sin datos)' }
            : null,
          sesiones: c.sesiones,
          facturado: num(sumar(c.facturado)),
        }))
        .sort((a, b) => b.facturado - a.facturado),
    };
  }

  /** Un profesional ve solo lo suyo; admin y recepción, todo el centro. */
  private async alcance(db: ClienteDeCentro, quien: UsuarioAutenticado) {
    if (quien.rol !== Rol.profesional) return null;
    const yo = await db.profesional.findFirst({
      where: { usuarioId: quien.usuarioId },
      select: { id: true },
    });
    if (!yo)
      throw new ForbiddenException(
        'Tu cuenta no está vinculada a una ficha de profesional',
      );
    return yo.id;
  }
}

@ApiTags('reportes')
@ApiBearerAuth()
@RequiereModulo(Modulo.reportes)
@Roles(Rol.admin, Rol.recepcion, Rol.profesional)
@Controller('reportes')
export class ReportesController {
  constructor(private readonly reportes: ReportesService) {}

  @Get()
  reporte(
    @CentroActual() centroId: string,
    @UsuarioActual() quien: UsuarioAutenticado,
    @Query({ schema: reporteSchema }) q: ReporteDto,
  ) {
    return this.reportes.reporte(centroId, quien, q);
  }
}

@Module({
  controllers: [ReportesController],
  providers: [ReportesService],
})
export class ReportesModule {}

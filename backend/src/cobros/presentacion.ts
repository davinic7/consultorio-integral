import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Injectable,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CentroActual, Roles } from '../auth/decoradores.js';
import { aFechaSolo } from '../common/comunes.js';
import { mesTexto, periodoDe } from '../common/tiempo.js';
import { ApiBodyZod } from '../common/zod.js';
import { Modulo, Rol } from '../generated/prisma/client.js';
import { RequiereModulo } from '../planes/planes.js';
import type { ClienteDeCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  emparejarTokens,
  leerTokens,
  sugerirFechas,
  type Sugerencia,
} from './presentacion-reglas.js';

const filtroSchema = z.object({ mes: mesTexto, financiadorId: z.uuid() });
const tokensSchema = filtroSchema.extend({
  /** Una línea por token, con el n.º de afiliado o el DNI opcionales. */
  texto: z.string().max(20_000),
  /** false: solo muestra cómo quedaría. */
  guardar: z.boolean().default(false),
});

const dia = (f: string) => new Date(`${f}T00:00:00Z`);

/**
 * Presentación mensual a una obra social (portado de osep.php, orden.php y
 * tokens.php, para cualquier obra social): fecha a declarar de cada sesión según
 * las reglas, tokens y marca de presentada.
 */
@Injectable()
export class PresentacionService {
  constructor(private readonly prisma: PrismaService) {}

  async ver(centroId: string, mes: string, financiadorId: string) {
    const db = this.db(centroId);
    const financiador = await this.financiador(db, financiadorId);
    const sesiones = await this.sesiones(db, mes, financiadorId);
    const sugeridas = this.sugerir(
      mes,
      financiador.maxSesionesSemana,
      sesiones,
    );

    const porPaciente = new Map<
      string,
      { paciente: (typeof sesiones)[number]['paciente']; sesiones: unknown[] }
    >();
    for (const s of sesiones) {
      const g = porPaciente.get(s.pacienteId) ?? {
        paciente: s.paciente,
        sesiones: [],
      };
      porPaciente.set(s.pacienteId, g);
      const sug = sugeridas.get(s.id);
      g.sesiones.push({
        prestacionId: s.id,
        fecha: aFechaSolo(s.fecha),
        fechaDeclarada: aFechaSolo(s.fechaDeclarada),
        fechaSugerida: sug?.sugerida ?? null,
        aviso: sug?.aviso ?? null,
        orden: s.orden && { id: s.orden.id, numero: s.orden.numero },
        token: s.token,
        presentada: s.facturada,
      });
    }
    return {
      mes,
      financiador,
      resumen: {
        sesiones: sesiones.length,
        conOrden: sesiones.filter((s) => s.orden).length,
        conToken: sesiones.filter((s) => s.token).length,
        presentadas: sesiones.filter((s) => s.facturada).length,
      },
      pacientes: [...porPaciente.values()],
    };
  }

  /** Completa la fecha a declarar de las sesiones sin presentar que no la tienen. */
  async asignarFechas(centroId: string, mes: string, financiadorId: string) {
    const db = this.db(centroId);
    const f = await this.financiador(db, financiadorId);
    const sesiones = await this.sesiones(db, mes, financiadorId);
    const sugeridas = this.sugerir(mes, f.maxSesionesSemana, sesiones);
    let asignadas = 0;
    for (const s of sesiones) {
      const sug = sugeridas.get(s.id)?.sugerida;
      if (s.facturada || s.fechaDeclarada || !sug) continue;
      await db.prestacion.update({
        where: { id: s.id },
        data: { fechaDeclarada: dia(sug) },
      });
      asignadas++;
    }
    return { asignadas };
  }

  /** Asigna tokens pegados como texto a las sesiones del mes que no tienen. */
  async tokens(centroId: string, dto: z.infer<typeof tokensSchema>) {
    const db = this.db(centroId);
    await this.financiador(db, dto.financiadorId);
    const sesiones = await this.sesiones(db, dto.mes, dto.financiadorId);
    const pacientes = await db.paciente.findMany({
      where: {
        OR: [
          { financiadorId: dto.financiadorId },
          { id: { in: [...new Set(sesiones.map((s) => s.pacienteId))] } },
        ],
      },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        dni: true,
        nroAfiliado: true,
      },
    });
    const libres = new Map<string, { id: string; fecha: string }[]>();
    for (const s of sesiones) {
      if (s.token) continue;
      const l = libres.get(s.pacienteId) ?? [];
      l.push({ id: s.id, fecha: aFechaSolo(s.fecha)! });
      libres.set(s.pacienteId, l);
    }
    const conToken = await db.prestacion.findMany({
      where: {
        pacienteId: { in: pacientes.map((p) => p.id) },
        token: { not: null },
      },
      select: { pacienteId: true, token: true },
    });
    const usados = new Map<string, Set<string>>();
    for (const t of conToken) {
      const u = usados.get(t.pacienteId) ?? new Set<string>();
      u.add(t.token!);
      usados.set(t.pacienteId, u);
    }
    const items = leerTokens(dto.texto).slice(0, 300);
    const res = emparejarTokens(items, pacientes, libres, usados);
    let guardados = 0;
    if (dto.guardar) {
      for (const [i, r] of res.entries()) {
        if (r.estado !== 'ok') continue;
        const act = await db.prestacion.updateMany({
          where: { id: r.prestacionId!, token: null },
          data: { token: r.token },
        });
        guardados += act.count;
        // Encontrado por DNI y sin n.º de afiliado: se completa con el de la credencial.
        const afiliado = items[i]?.afiliado;
        if (r.por === 'dni' && afiliado) {
          await db.paciente.updateMany({
            where: { id: r.pacienteId!, nroAfiliado: null },
            data: { nroAfiliado: afiliado.slice(0, 40) },
          });
        }
      }
    }
    const nombre = new Map(
      pacientes.map((p) => [p.id, `${p.nombre} ${p.apellido}`]),
    );
    return {
      guardados,
      items: res.map((r) => ({
        ...r,
        paciente: r.pacienteId ? (nombre.get(r.pacienteId) ?? null) : null,
      })),
    };
  }

  // ───────── Internos ─────────

  /**
   * Sugerencia por sesión: cada orden por separado (desde su emisión hasta su
   * vencimiento) y las sesiones sin orden, desde el primer día del mes. No se
   * repiten las fechas ya declaradas de sesiones presentadas.
   */
  private sugerir(
    mes: string,
    maxSemana: number | null,
    sesiones: Awaited<ReturnType<PresentacionService['sesiones']>>,
  ): Map<string, Sugerencia> {
    const res = new Map<string, Sugerencia>();
    const porPaciente = new Map<string, typeof sesiones>();
    for (const s of sesiones) {
      const l = porPaciente.get(s.pacienteId) ?? [];
      l.push(s);
      porPaciente.set(s.pacienteId, l);
    }
    for (const suyas of porPaciente.values()) {
      const ocupadas = suyas
        .filter((s) => s.facturada && s.fechaDeclarada)
        .map((s) => aFechaSolo(s.fechaDeclarada)!);
      const grupos = new Map<string, typeof suyas>();
      for (const s of suyas.filter((x) => !x.facturada)) {
        const k = s.orden?.id ?? 'sin-orden';
        grupos.set(k, [...(grupos.get(k) ?? []), s]);
      }
      for (const grupo of grupos.values()) {
        const orden = grupo[0]!.orden;
        const sug = sugerirFechas({
          mes,
          reales: grupo.map((s) => aFechaSolo(s.fecha)!),
          emision: orden ? aFechaSolo(orden.fechaEmision) : null,
          vence: orden ? aFechaSolo(orden.vence) : null,
          ocupadas,
          maxSemana,
        });
        // sugerirFechas ordena por fecha real: se empareja en el mismo orden.
        const ordenadas = [...grupo].sort(
          (a, b) => a.fecha.getTime() - b.fecha.getTime(),
        );
        ordenadas.forEach((s, i) => res.set(s.id, sug[i]!));
        ocupadas.push(
          ...sug.map((x) => x.sugerida).filter((x): x is string => !!x),
        );
      }
    }
    return res;
  }

  private sesiones(db: ClienteDeCentro, mes: string, financiadorId: string) {
    return db.prestacion.findMany({
      where: { periodo: periodoDe(mes), financiadorId },
      select: {
        id: true,
        pacienteId: true,
        fecha: true,
        fechaDeclarada: true,
        token: true,
        facturada: true,
        paciente: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            dni: true,
            nroAfiliado: true,
          },
        },
        orden: {
          select: { id: true, numero: true, fechaEmision: true, vence: true },
        },
      },
      orderBy: [{ paciente: { apellido: 'asc' } }, { fecha: 'asc' }],
    });
  }

  private async financiador(db: ClienteDeCentro, id: string) {
    const f = await db.financiador.findUnique({
      where: { id },
      select: {
        id: true,
        nombre: true,
        codigoPrestacion: true,
        requiereOrden: true,
        requiereToken: true,
        maxSesionesSemana: true,
      },
    });
    if (!f) throw new NotFoundException('Obra social no encontrada');
    return f;
  }

  private db(centroId: string): ClienteDeCentro {
    return this.prisma.paraCentro(centroId);
  }
}

@ApiTags('obras sociales')
@ApiBearerAuth()
@RequiereModulo(Modulo.obras_sociales)
@Roles(Rol.admin, Rol.recepcion)
@Controller('presentacion')
export class PresentacionController {
  constructor(private readonly presentacion: PresentacionService) {}

  /** Sesiones del mes con esa obra social, por paciente, con la fecha a declarar sugerida. */
  @Get()
  ver(
    @CentroActual() centroId: string,
    @Query({ schema: filtroSchema }) q: z.infer<typeof filtroSchema>,
  ) {
    return this.presentacion.ver(centroId, q.mes, q.financiadorId);
  }

  @Post('fechas')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(filtroSchema)
  fechas(
    @CentroActual() centroId: string,
    @Body({ schema: filtroSchema }) dto: z.infer<typeof filtroSchema>,
  ) {
    return this.presentacion.asignarFechas(
      centroId,
      dto.mes,
      dto.financiadorId,
    );
  }

  @Post('tokens')
  @HttpCode(HttpStatus.OK)
  @ApiBodyZod(tokensSchema)
  tokens(
    @CentroActual() centroId: string,
    @Body({ schema: tokensSchema }) dto: z.infer<typeof tokensSchema>,
  ) {
    return this.presentacion.tokens(centroId, dto);
  }
}

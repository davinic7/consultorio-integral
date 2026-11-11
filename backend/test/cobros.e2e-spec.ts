import 'dotenv/config';
import { TODOS_LOS_MODULOS } from './ayudas.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../src/auth/password.js';
import {
  EstadoAsistencia,
  PrismaClient,
  Rol,
} from '../src/generated/prisma/client.js';
import { adaptadorPg } from '../src/prisma/adaptador.js';

const url = process.env.TEST_DATABASE_URL;
const CLAVE = 'clave-de-prueba-123';
const MES = '2026-10';

interface Prestacion {
  id: string;
  turnoId: string;
  fecha: string;
  monto: number;
  montoManual: boolean;
  facturada: boolean;
  token: string | null;
  orden: { id: string; numero: string } | null;
  financiador: { id: string; nombre: string } | null;
  cobrado: number;
  saldo: number;
  estadoCobro: string;
  pagos: { id: string; monto: number; medio: string; estado: string }[];
  avisos: string[];
  cerrada: boolean;
}

describe.skipIf(!url)('Cobros y liquidación (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const como = (quien: string) => ({
    Authorization: `Bearer ${tokens[quien]}`,
  });
  const marcar = (turnoId: string, estado: string) =>
    http()
      .post(`/api/v1/turnos/${turnoId}/asistencia`)
      .set(como('recep@a.com'))
      .send({ estado });
  const prestaciones = async (quien = 'admin@a.com', extra = '') =>
    (
      await http()
        .get(`/api/v1/prestaciones?mes=${MES}${extra}`)
        .set(como(quien))
        .expect(200)
    ).body as Prestacion[];
  const deTurno = async (turnoId: string) =>
    (await prestaciones()).find((p) => p.turnoId === turnoId);

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.LOGIN_LIMITE_POR_MIN = '1000';
    prisma = new PrismaClient({ adapter: adaptadorPg(url!) });
    await prisma.$executeRawUnsafe(
      'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
    );
    const plan = await prisma.plan.create({
      data: { codigo: 'integral', nombre: 'Integral', precioMensual: 0, modulos: TODOS_LOS_MODULOS },
    });
    const a = await prisma.centro.create({
      data: { nombre: 'A', slug: 'a', planId: plan.id },
    });
    ids.centroA = a.id;
    const b = await prisma.centro.create({
      data: { nombre: 'B', slug: 'b', planId: plan.id },
    });
    const passwordHash = await hashPassword(CLAVE);
    const usuario = async (email: string, centroId: string, rol: Rol) => {
      const u = await prisma.usuario.create({
        data: { email, nombre: email, passwordHash },
      });
      await prisma.miembro.create({ data: { centroId, usuarioId: u.id, rol } });
      return u.id;
    };
    await usuario('admin@a.com', a.id, Rol.admin);
    await usuario('recep@a.com', a.id, Rol.recepcion);
    const u1 = await usuario('prof1@a.com', a.id, Rol.profesional);
    const u2 = await usuario('prof2@a.com', a.id, Rol.profesional);
    await usuario('admin@b.com', b.id, Rol.admin);

    const prof = async (
      nombre: string,
      usuarioId: string,
      porcentaje: number,
    ) =>
      (
        await prisma.profesional.create({
          data: {
            centroId: a.id,
            nombre,
            apellido: nombre === 'Pablo' ? 'Paz' : 'Ríos',
            disciplina: 'Psicología',
            usuarioId,
            porcentajeLiquidacion: porcentaje,
          },
        })
      ).id;
    ids.p1 = await prof('Pablo', u1, 70);
    ids.p2 = await prof('Laura', u2, 60);

    ids.osep = (
      await prisma.financiador.create({
        data: {
          centroId: a.id,
          nombre: 'OSEP',
          tipo: 'obra_social',
          requiereOrden: true,
          requiereToken: true,
          diasValidezOrden: 30,
        },
      })
    ).id;
    const paciente = async (nombre: string, financiadorId: string | null) =>
      (
        await prisma.paciente.create({
          data: { centroId: a.id, nombre, apellido: 'Test', financiadorId },
        })
      ).id;
    ids.juan = await paciente('Juan', ids.osep);
    ids.ana = await paciente('Ana', null);
    for (const [pacienteId, profesionalId] of [
      [ids.juan, ids.p1],
      [ids.ana, ids.p1],
      [ids.ana, ids.p2],
    ]) {
      await prisma.pacienteProfesional.create({
        data: { centroId: a.id, pacienteId, profesionalId },
      });
    }

    const { AppModule } = await import('../src/app.module.js');
    const { setupApp } = await import('../src/setup-app.js');
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    setupApp(app);
    await app.init();
    for (const quien of [
      'admin@a.com',
      'recep@a.com',
      'prof1@a.com',
      'prof2@a.com',
      'admin@b.com',
    ]) {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: quien, password: CLAVE });
      tokens[quien] = res.body.accessToken;
    }

    const turno = async (
      pacienteId: string,
      profesionalId: string,
      fecha: string,
      hora = '10:00',
    ) =>
      (
        await http()
          .post('/api/v1/turnos')
          .set(como('admin@a.com'))
          .send({ pacienteId, profesionalId, fecha, hora, duracionMin: 45 })
          .expect(201)
      ).body.id as string;
    ids.j1 = await turno(ids.juan, ids.p1, '2026-10-05');
    ids.j2 = await turno(ids.juan, ids.p1, '2026-10-07');
    ids.j3 = await turno(ids.juan, ids.p1, '2026-10-12');
    ids.a1 = await turno(ids.ana, ids.p1, '2026-10-06', '11:00');
    ids.a2 = await turno(ids.ana, ids.p2, '2026-10-08', '11:00');
    ids.pendiente = await turno(ids.ana, ids.p1, '2026-10-20', '11:00');
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('precios', () => {
    it('el admin carga el valor de particular y de la obra social', async () => {
      for (const [financiadorId, monto] of [
        [null, 10000],
        [ids.osep, 8000],
      ] as const) {
        await http()
          .post('/api/v1/precios')
          .set(como('admin@a.com'))
          .send({ financiadorId, monto, vigenteDesde: '2026-01-01' })
          .expect(201);
      }
      const res = await http()
        .get('/api/v1/precios')
        .set(como('recep@a.com'))
        .expect(200);
      expect(res.body).toHaveLength(2);
      expect(res.body.every((p: { vigente: boolean }) => p.vigente)).toBe(true);
    });

    it('recepción no carga precios y se validan los montos', async () => {
      await http()
        .post('/api/v1/precios')
        .set(como('recep@a.com'))
        .send({ financiadorId: null, monto: 1, vigenteDesde: '2026-01-01' })
        .expect(403);
      await http()
        .post('/api/v1/precios')
        .set(como('admin@a.com'))
        .send({ financiadorId: null, monto: -5, vigenteDesde: '2026-01-01' })
        .expect(400);
      await http()
        .post('/api/v1/precios')
        .set(como('admin@a.com'))
        .send({
          financiadorId: null,
          monto: 10.123,
          vigenteDesde: '2026-01-01',
        })
        .expect(400);
    });
  });

  describe('prestaciones con la asistencia', () => {
    it('marcar presente crea la prestación con el precio y la cobertura del paciente', async () => {
      await marcar(ids.j1, 'presente').expect(200);
      const p = await deTurno(ids.j1);
      expect(p).toMatchObject({
        fecha: '2026-10-05',
        monto: 8000,
        financiador: { nombre: 'OSEP' },
        orden: null,
        estadoCobro: 'pendiente',
      });
      expect(p!.avisos).toEqual(['falta_orden', 'falta_token', 'sin_facturar']);
      ids.prJ1 = p!.id;
    });

    it('una orden nueva se asigna a las sesiones que la esperaban y las siguientes la usan', async () => {
      const res = await http()
        .post('/api/v1/ordenes')
        .set(como('recep@a.com'))
        .send({
          pacienteId: ids.juan,
          financiadorId: ids.osep,
          numero: 'A-100',
          fechaEmision: '2026-10-01',
          sesiones: 2,
        })
        .expect(201);
      expect(res.body).toMatchObject({
        vence: '2026-10-30',
        usadas: 1,
        disponibles: 1,
        fechasUsadas: ['2026-10-05'],
      });
      ids.ordenA = res.body.id;

      await marcar(ids.j2, 'presente').expect(200);
      expect((await deTurno(ids.j2))!.orden?.numero).toBe('A-100');
      // La orden ya está llena: la tercera queda sin orden.
      await marcar(ids.j3, 'presente').expect(200);
      expect((await deTurno(ids.j3))!.avisos).toContain('falta_orden');

      await http()
        .post('/api/v1/ordenes')
        .set(como('recep@a.com'))
        .send({
          pacienteId: ids.juan,
          financiadorId: ids.osep,
          numero: 'A-100',
          fechaEmision: '2026-10-01',
          sesiones: 2,
        })
        .expect(409);
      await http()
        .delete(`/api/v1/ordenes/${ids.ordenA}`)
        .set(como('recep@a.com'))
        .expect(409);
      await http()
        .patch(`/api/v1/ordenes/${ids.ordenA}`)
        .set(como('recep@a.com'))
        .send({ sesiones: 1 })
        .expect(409);
    });

    it('un aumento recalcula solo las sesiones desde su vigencia', async () => {
      const res = await http()
        .post('/api/v1/precios')
        .set(como('admin@a.com'))
        .send({
          financiadorId: ids.osep,
          monto: 9000,
          vigenteDesde: '2026-10-10',
        })
        .expect(201);
      expect(res.body.recalculadas).toBe(1);
      expect((await deTurno(ids.j1))!.monto).toBe(8000);
      expect((await deTurno(ids.j3))!.monto).toBe(9000);
    });

    it('particular: precio especial del paciente y cobro', async () => {
      await marcar(ids.a1, 'presente').expect(200);
      expect((await deTurno(ids.a1))!).toMatchObject({
        monto: 10000,
        financiador: null,
      });
      const precio = await http()
        .post('/api/v1/precios')
        .set(como('admin@a.com'))
        .send({
          financiadorId: null,
          pacienteId: ids.ana,
          monto: 7000,
          vigenteDesde: '2026-10-01',
        })
        .expect(201);
      expect(precio.body.recalculadas).toBe(1);
      const p = (await deTurno(ids.a1))!;
      expect(p.monto).toBe(7000);
      expect(p.avisos).toEqual(['impaga']);
      ids.prA1 = p.id;

      // Más que el saldo: no.
      await http()
        .post(`/api/v1/prestaciones/${p.id}/pagos`)
        .set(como('recep@a.com'))
        .send({ medio: 'efectivo', monto: 7000.01 })
        .expect(409);
      const pagado = await http()
        .post(`/api/v1/prestaciones/${p.id}/pagos`)
        .set(como('recep@a.com'))
        .send({ medio: 'efectivo', fecha: '2026-10-06' })
        .expect(201);
      expect(pagado.body).toMatchObject({
        cobrado: 7000,
        saldo: 0,
        estadoCobro: 'cobrada',
        avisos: [],
      });
      ids.pagoA1 = pagado.body.pagos[0].id;
      await http()
        .post(`/api/v1/prestaciones/${p.id}/pagos`)
        .set(como('recep@a.com'))
        .send({ medio: 'efectivo' })
        .expect(409);
      // Un cambio de precio ya no toca una sesión con pagos.
      const otro = await http()
        .post('/api/v1/precios')
        .set(como('admin@a.com'))
        .send({
          financiadorId: null,
          pacienteId: ids.ana,
          monto: 7500,
          vigenteDesde: '2026-10-02',
        })
        .expect(201);
      expect(otro.body.recalculadas).toBe(0);
    });

    it('con pagos no se puede sacar de presente; sin pagos, la prestación se borra', async () => {
      await marcar(ids.a1, 'ausente_sin_aviso').expect(409);
      await http()
        .delete(`/api/v1/pagos/${ids.pagoA1}`)
        .set(como('recep@a.com'))
        .expect(200);
      await marcar(ids.a1, 'ausente_sin_aviso').expect(200);
      expect(await deTurno(ids.a1)).toBeUndefined();
      await marcar(ids.a1, 'presente').expect(200);
      const p = (await deTurno(ids.a1))!;
      expect(p.monto).toBe(7500); // precio especial vigente el 6/10
      ids.prA1 = p.id;
    });

    it('token, monto a mano, facturar y cobrar en lote', async () => {
      const j3 = (await deTurno(ids.j3))!;
      const tok = await http()
        .patch(`/api/v1/prestaciones/${j3.id}`)
        .set(como('recep@a.com'))
        .send({ token: ' ab12 ' })
        .expect(200);
      expect(tok.body.token).toBe('AB12');

      const manual = await http()
        .patch(`/api/v1/prestaciones/${ids.prJ1}`)
        .set(como('recep@a.com'))
        .send({ monto: 8500 })
        .expect(200);
      expect(manual.body).toMatchObject({ monto: 8500, montoManual: true });
      const auto = await http()
        .patch(`/api/v1/prestaciones/${ids.prJ1}`)
        .set(como('recep@a.com'))
        .send({ monto: null })
        .expect(200);
      expect(auto.body).toMatchObject({ monto: 8000, montoManual: false });

      const deJuan = (await prestaciones()).filter((p) => p.financiador);
      await http()
        .post('/api/v1/prestaciones/facturar')
        .set(como('recep@a.com'))
        .send({ ids: deJuan.map((p) => p.id) })
        .expect(200, { actualizadas: 3 });
      const lote = await http()
        .post('/api/v1/pagos/lote')
        .set(como('recep@a.com'))
        .send({
          prestacionIds: deJuan.map((p) => p.id),
          medio: 'transferencia',
          fecha: '2026-11-05',
        })
        .expect(201);
      expect(lote.body).toEqual({ pagos: 3, total: 25000, sinSaldo: 0 });
      const ahora = (await prestaciones()).filter((p) => p.financiador);
      expect(ahora.every((p) => p.estadoCobro === 'cobrada')).toBe(true);
    });

    it('un pago rechazado deja la sesión rechazada', async () => {
      const j2 = (await deTurno(ids.j2))!;
      const res = await http()
        .patch(`/api/v1/pagos/${j2.pagos[0].id}`)
        .set(como('recep@a.com'))
        .send({ estado: 'rechazado' })
        .expect(200);
      expect(res.body.estadoCobro).toBe('rechazada');
      expect(res.body.avisos).toContain('rechazada');
    });
  });

  describe('resumen y conciliación', () => {
    it('resumen del mes', async () => {
      const res = await http()
        .get(`/api/v1/cobros/resumen?mes=${MES}`)
        .set(como('recep@a.com'))
        .expect(200);
      // Juan: 8000 + 8000 + 9000 (el aumento rige desde el 10/10); Ana: 7500.
      // Cobrado: Juan 1 y 3 (el pago de la 2 fue rechazado).
      expect(res.body).toMatchObject({
        sesiones: 4,
        facturado: 32500,
        cobrado: 17000,
        porCobrar: 15500,
        porCobrarSesiones: 2,
        cobradoPorMedio: [{ medio: 'transferencia', monto: 17000 }],
        cobradoPorDia: [{ fecha: '2026-11-05', monto: 17000 }],
      });
      // Pablo (70 %): 32500 × 0,7
      expect(res.body.aLiquidar).toBe(22750);
      expect(res.body.retencion).toBe(9750);
    });

    it('conciliación: detecta presentes sin prestación y las genera', async () => {
      // Turno presente de antes de cobros (sin prestación).
      await prisma.turno.update({
        where: { id: ids.a2 },
        data: { estadoAsistencia: EstadoAsistencia.presente },
      });
      const res = await http()
        .get(`/api/v1/cobros/conciliacion?mes=${MES}`)
        .set(como('admin@a.com'))
        .expect(200);
      expect(res.body.sinPrestacion).toHaveLength(1);
      expect(res.body.conteo).toMatchObject({
        sin_prestacion: 1,
        rechazada: 1,
        impaga: 1,
      });
      const laura = res.body.porProfesional.find(
        (f: { profesional: { id: string } }) => f.profesional.id === ids.p2,
      );
      expect(laura).toMatchObject({ presentes: 1, prestaciones: 0 });

      await http()
        .post('/api/v1/prestaciones/generar')
        .set(como('recep@a.com'))
        .send({ mes: MES })
        .expect(200, { creadas: 1, omitidas: 0 });
      const otra = await http()
        .get(`/api/v1/cobros/conciliacion?mes=${MES}`)
        .set(como('admin@a.com'))
        .expect(200);
      expect(otra.body.sinPrestacion).toHaveLength(0);
    });
  });

  describe('liquidación', () => {
    it('muestra por profesional lo facturado, el porcentaje y lo que le toca', async () => {
      const res = await http()
        .get(`/api/v1/liquidaciones?mes=${MES}`)
        .set(como('admin@a.com'))
        .expect(200);
      const pablo = res.body.find(
        (t: { profesional: { id: string } }) => t.profesional.id === ids.p1,
      );
      expect(pablo).toMatchObject({
        sesiones: 4,
        facturado: 32500,
        porcentaje: 70,
        retencionPorcentaje: 30,
        aLiquidar: 22750,
        retencion: 9750,
        liquidacion: null,
        sinMarcar: 1,
      });
    });

    it('no se genera con turnos sin marcar; generada, cierra el mes', async () => {
      await http()
        .post('/api/v1/liquidaciones')
        .set(como('admin@a.com'))
        .send({ profesionalId: ids.p1, mes: MES })
        .expect(409);
      await marcar(ids.pendiente, 'ausente_con_aviso').expect(200);
      const res = await http()
        .post('/api/v1/liquidaciones')
        .set(como('admin@a.com'))
        .send({ profesionalId: ids.p1, mes: MES })
        .expect(201);
      expect(res.body).toMatchObject({
        aLiquidar: 22750,
        liquidacion: { estado: 'cerrada' },
      });
      ids.liqP1 = res.body.liquidacion.id;

      await http()
        .post('/api/v1/liquidaciones')
        .set(como('admin@a.com'))
        .send({ profesionalId: ids.p1, mes: MES })
        .expect(409);
      // Mes cerrado: ni asistencia ni monto; el token y los pagos sí.
      await marcar(ids.j1, 'ausente_sin_aviso').expect(409);
      await http()
        .patch(`/api/v1/prestaciones/${ids.prA1}`)
        .set(como('recep@a.com'))
        .send({ monto: 1 })
        .expect(409);
      const a1 = await http()
        .post(`/api/v1/prestaciones/${ids.prA1}/pagos`)
        .set(como('recep@a.com'))
        .send({ medio: 'efectivo' })
        .expect(201);
      expect(a1.body).toMatchObject({ cerrada: true, estadoCobro: 'cobrada' });
      // Un cambio de porcentaje no toca lo ya liquidado.
      await prisma.profesional.update({
        where: { id: ids.p1 },
        data: { porcentajeLiquidacion: 50 },
      });
      const lista = await http()
        .get(`/api/v1/liquidaciones?mes=${MES}`)
        .set(como('admin@a.com'))
        .expect(200);
      expect(
        lista.body.find(
          (t: { profesional: { id: string } }) => t.profesional.id === ids.p1,
        ).aLiquidar,
      ).toBe(22750);
    });

    it('se marca pagada; una pagada no se reabre', async () => {
      const res = await http()
        .post(`/api/v1/liquidaciones/${ids.liqP1}/pagar`)
        .set(como('admin@a.com'))
        .expect(200);
      expect(res.body.liquidacion.estado).toBe('pagada');
      await http()
        .post(`/api/v1/liquidaciones/${ids.liqP1}/reabrir`)
        .set(como('admin@a.com'))
        .expect(409);
    });

    it('una cerrada se reabre y vuelve a permitir cambios', async () => {
      const res = await http()
        .post('/api/v1/liquidaciones')
        .set(como('admin@a.com'))
        .send({ profesionalId: ids.p2, mes: MES })
        .expect(201);
      // Laura (60 %): la sesión de Ana del 8/10, a 7500.
      expect(res.body).toMatchObject({
        sesiones: 1,
        facturado: 7500,
        aLiquidar: 4500,
      });
      await marcar(ids.a2, 'ausente_con_aviso').expect(409);
      const reabierta = await http()
        .post(`/api/v1/liquidaciones/${res.body.liquidacion.id}/reabrir`)
        .set(como('admin@a.com'))
        .expect(200);
      expect(reabierta.body.liquidacion.estado).toBe('borrador');
      await marcar(ids.a2, 'ausente_con_aviso').expect(200);
    });
  });

  describe('permisos y aislamiento', () => {
    it('cada profesional ve solo lo suyo y no gestiona cobros', async () => {
      const suyas = await prestaciones('prof2@a.com');
      expect(suyas).toHaveLength(0);
      const dePablo = await prestaciones('prof1@a.com');
      expect(dePablo).toHaveLength(4);
      // Pedir las de otro profesional no amplía el alcance.
      expect(
        await prestaciones('prof2@a.com', `&profesionalId=${ids.p1}`),
      ).toHaveLength(0);
      const liq = await http()
        .get(`/api/v1/liquidaciones?mes=${MES}`)
        .set(como('prof2@a.com'))
        .expect(200);
      expect(liq.body).toHaveLength(1);
      expect(liq.body[0].profesional.id).toBe(ids.p2);
      await http()
        .patch(`/api/v1/prestaciones/${ids.prA1}`)
        .set(como('prof1@a.com'))
        .send({ token: 'X1' })
        .expect(403);
      await http()
        .post('/api/v1/liquidaciones')
        .set(como('prof1@a.com'))
        .send({ profesionalId: ids.p1, mes: MES })
        .expect(403);
    });

    it('recepción no ve liquidaciones', async () => {
      await http()
        .get(`/api/v1/liquidaciones?mes=${MES}`)
        .set(como('recep@a.com'))
        .expect(403);
    });

    it('otro centro no ve ni toca nada', async () => {
      expect(await prestaciones('admin@b.com')).toEqual([]);
      await http()
        .patch(`/api/v1/prestaciones/${ids.prA1}`)
        .set(como('admin@b.com'))
        .send({ token: 'X1' })
        .expect(404);
      await http()
        .post(`/api/v1/prestaciones/${ids.prJ1}/pagos`)
        .set(como('admin@b.com'))
        .send({ medio: 'efectivo' })
        .expect(404);
      await http()
        .get(`/api/v1/ordenes?pacienteId=${ids.juan}`)
        .set(como('admin@b.com'))
        .expect(404);
      await http()
        .post(`/api/v1/liquidaciones/${ids.liqP1}/pagar`)
        .set(como('admin@b.com'))
        .expect(404);
      const resumen = await http()
        .get(`/api/v1/cobros/resumen?mes=${MES}`)
        .set(como('admin@b.com'))
        .expect(200);
      expect(resumen.body).toMatchObject({ sesiones: 0, facturado: 0 });
    });
  });
});

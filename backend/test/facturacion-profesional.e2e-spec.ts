import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../src/auth/password.js';
import { PrismaClient, Rol } from '../src/generated/prisma/client.js';
import { adaptadorPg } from '../src/prisma/adaptador.js';
import { TODOS_LOS_MODULOS } from './ayudas.js';

const url = process.env.TEST_DATABASE_URL;
const CLAVE = 'clave-de-prueba-123';
const MES = '2026-10';

/** Cada profesional factura sus sesiones con su propio CUIT. */
describe.skipIf(!url)('Facturación por profesional (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const como = (quien: string) => ({
    Authorization: `Bearer ${tokens[quien]}`,
  });
  const F = '/api/v1/facturacion';

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.LOGIN_LIMITE_POR_MIN = '1000';
    prisma = new PrismaClient({ adapter: adaptadorPg(url!) });
    await prisma.$executeRawUnsafe(
      'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
    );
    const plan = await prisma.plan.create({
      data: {
        codigo: 'integral',
        nombre: 'Integral',
        precioMensual: 0,
        modulos: TODOS_LOS_MODULOS,
      },
    });
    const centro = await prisma.centro.create({
      data: { nombre: 'A', slug: 'a', planId: plan.id },
    });
    const passwordHash = await hashPassword(CLAVE);
    const usuarios: Record<string, string> = {};
    for (const [email, rol] of [
      ['admin', Rol.admin],
      ['recep', Rol.recepcion],
      ['prof1', Rol.profesional],
    ] as const) {
      const u = await prisma.usuario.create({
        data: { email: `${email}@a.com`, nombre: email, passwordHash },
      });
      usuarios[email] = u.id;
      await prisma.miembro.create({
        data: { centroId: centro.id, usuarioId: u.id, rol },
      });
    }
    const prof = async (apellido: string, usuarioId?: string) =>
      (
        await prisma.profesional.create({
          data: {
            centroId: centro.id,
            nombre: 'P',
            apellido,
            disciplina: 'Psicología',
            usuarioId,
          },
        })
      ).id;
    ids.p1 = await prof('Uno', usuarios.prof1);
    ids.p2 = await prof('Dos');
    const paciente = async (nombre: string, dni: string) =>
      (
        await prisma.paciente.create({
          data: { centroId: centro.id, nombre, apellido: 'Test', dni },
        })
      ).id;
    ids.ana = await paciente('Ana', '30111222');
    ids.beto = await paciente('Beto', '30111333');

    const { AppModule } = await import('../src/app.module.js');
    const { setupApp } = await import('../src/setup-app.js');
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    setupApp(app);
    await app.init();
    for (const quien of ['admin', 'recep', 'prof1']) {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: `${quien}@a.com`, password: CLAVE })
        .expect(200);
      tokens[quien] = res.body.accessToken;
    }

    await http()
      .post('/api/v1/precios')
      .set(como('admin'))
      .send({ financiadorId: null, monto: 10000, vigenteDesde: '2026-01-01' })
      .expect(201);
    // Ana se atiende con Uno (2 sesiones), Beto con Dos (1). Todo pagado.
    for (const [pacienteId, profesionalId, fecha] of [
      [ids.ana, ids.p1, '2026-10-06'],
      [ids.ana, ids.p1, '2026-10-13'],
      [ids.beto, ids.p2, '2026-10-07'],
    ]) {
      const t = await http()
        .post('/api/v1/turnos')
        .set(como('admin'))
        .send({
          pacienteId,
          profesionalId,
          fecha,
          hora: '10:00',
          duracionMin: 45,
        })
        .expect(201);
      await http()
        .post(`/api/v1/turnos/${t.body.id}/asistencia`)
        .set(como('admin'))
        .send({ estado: 'presente' })
        .expect(200);
    }
    const prestaciones = await http()
      .get(`/api/v1/prestaciones?mes=${MES}`)
      .set(como('admin'))
      .expect(200);
    await http()
      .post('/api/v1/pagos/lote')
      .set(como('admin'))
      .send({
        prestacionIds: prestaciones.body.map((p: { id: string }) => p.id),
        medio: 'efectivo',
      })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('por defecto factura el centro: el profesional no entra', async () => {
    const cfg = await http().get(`${F}/config`).set(como('admin')).expect(200);
    expect(cfg.body).toMatchObject({
      facturaCadaProfesional: false,
      profesionalId: null,
    });
    await http().get(`${F}/config`).set(como('prof1')).expect(403);
    await http()
      .get(`${F}/pendientes?mes=${MES}`)
      .set(como('prof1'))
      .expect(403);
    const pend = await http()
      .get(`${F}/pendientes?mes=${MES}`)
      .set(como('admin'))
      .expect(200);
    expect(pend.body).toHaveLength(2);
  });

  it('solo el admin elige que factura cada profesional, en los datos del centro', async () => {
    await http()
      .put(`${F}/config?profesionalId=${ids.p1}`)
      .set(como('admin'))
      .send({ facturaCadaProfesional: true })
      .expect(400);
    await http()
      .put(`${F}/config`)
      .set(como('recep'))
      .send({ facturaCadaProfesional: true })
      .expect(403);
    const res = await http()
      .put(`${F}/config`)
      .set(como('admin'))
      .send({ facturaCadaProfesional: true })
      .expect(200);
    expect(res.body.facturaCadaProfesional).toBe(true);
  });

  it('el profesional carga sus propios datos fiscales y no ve los de otro', async () => {
    const mio = await http().get(`${F}/config`).set(como('prof1')).expect(200);
    expect(mio.body).toMatchObject({
      profesionalId: ids.p1,
      modo: 'simulado',
      cuit: null,
    });
    await http()
      .get(`${F}/config?profesionalId=${ids.p2}`)
      .set(como('prof1'))
      .expect(403);
    const ok = await http()
      .put(`${F}/config`)
      .set(como('prof1'))
      .send({ cuit: '27-11111111-1', razonSocial: 'P Uno' })
      .expect(200);
    expect(ok.body).toMatchObject({
      cuit: '27111111111',
      profesionalId: ids.p1,
    });
    await http()
      .put(`${F}/config`)
      .set(como('prof1'))
      .send({ facturaCadaProfesional: false })
      .expect(400);
    // Recepción no cambia datos fiscales de nadie.
    await http()
      .put(`${F}/config?profesionalId=${ids.p2}`)
      .set(como('recep'))
      .send({ razonSocial: 'X' })
      .expect(403);
  });

  it('admin y recepción tienen que elegir el profesional para facturar', async () => {
    await http()
      .get(`${F}/pendientes?mes=${MES}`)
      .set(como('admin'))
      .expect(400);
    const p2 = await http()
      .get(`${F}/pendientes?mes=${MES}&profesionalId=${ids.p2}`)
      .set(como('recep'))
      .expect(200);
    expect(
      p2.body.map((g: { paciente: { nombre: string } }) => g.paciente.nombre),
    ).toEqual(['Beto']);
    const emisores = await http()
      .get(`${F}/emisores`)
      .set(como('admin'))
      .expect(200);
    expect(emisores.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          profesional: expect.objectContaining({ id: ids.p1 }),
          cuit: '27111111111',
        }),
        expect.objectContaining({
          profesional: expect.objectContaining({ id: ids.p2 }),
          cuit: null,
        }),
      ]),
    );
  });

  it('cada profesional factura sus sesiones con numeración propia', async () => {
    const pend = await http()
      .get(`${F}/pendientes?mes=${MES}`)
      .set(como('prof1'))
      .expect(200);
    expect(pend.body).toHaveLength(1);
    expect(pend.body[0]).toMatchObject({ sesiones: 2, total: 20000 });
    const e1 = await http()
      .post(`${F}/emitir`)
      .set(como('prof1'))
      .send({ mes: MES, pacienteIds: [ids.ana, ids.beto] })
      .expect(200);
    expect(e1.body.emitidas).toBe(1);

    const e2 = await http()
      .post(`${F}/emitir`)
      .set(como('admin'))
      .send({ mes: MES, pacienteIds: [ids.beto], profesionalId: ids.p2 })
      .expect(200);
    expect(e2.body.emitidas).toBe(1);

    const facturas = await prisma.factura.findMany({
      orderBy: { creadaEn: 'asc' },
    });
    expect(facturas.map((f) => [f.profesionalId, f.numero])).toEqual([
      [ids.p1, 1],
      [ids.p2, 1],
    ]);
    expect(facturas[0]!.configFiscalId).not.toBe(facturas[1]!.configFiscalId);
  });

  it('el profesional solo ve y descarga sus facturas', async () => {
    const mias = await http()
      .get(`${F}/facturas?mes=${MES}`)
      .set(como('prof1'))
      .expect(200);
    expect(mias.body).toHaveLength(1);
    expect(mias.body[0].profesional.id).toBe(ids.p1);
    const todas = await http()
      .get(`${F}/facturas?mes=${MES}`)
      .set(como('admin'))
      .expect(200);
    expect(todas.body).toHaveLength(2);
    const ajena = todas.body.find(
      (f: { profesional: { id: string } }) => f.profesional.id === ids.p2,
    );
    await http()
      .get(`${F}/facturas/${ajena.id}/pdf`)
      .set(como('prof1'))
      .expect(404);
    await http()
      .get(`${F}/facturas/${mias.body[0].id}/pdf`)
      .set(como('prof1'))
      .expect(200)
      .expect('content-type', 'application/pdf');
  });
});

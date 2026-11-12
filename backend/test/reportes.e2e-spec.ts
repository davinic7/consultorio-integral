import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../src/auth/password.js';
import { Modulo, PrismaClient, Rol } from '../src/generated/prisma/client.js';
import { adaptadorPg } from '../src/prisma/adaptador.js';
import { TODOS_LOS_MODULOS } from './ayudas.js';

const url = process.env.TEST_DATABASE_URL;
const CLAVE = 'clave-de-prueba-123';

describe.skipIf(!url)('Reportes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const como = (quien: string) => ({
    Authorization: `Bearer ${tokens[quien]}`,
  });
  const R = '/api/v1/reportes';

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.LOGIN_LIMITE_POR_MIN = '1000';
    prisma = new PrismaClient({ adapter: adaptadorPg(url!) });
    await prisma.$executeRawUnsafe(
      'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
    );
    const integral = await prisma.plan.create({
      data: {
        codigo: 'integral',
        nombre: 'Integral',
        precioMensual: 0,
        modulos: TODOS_LOS_MODULOS,
      },
    });
    const basico = await prisma.plan.create({
      data: {
        codigo: 'basico',
        nombre: 'Básico',
        precioMensual: 0,
        modulos: { create: [{ modulo: Modulo.agenda }] },
      },
    });
    const a = await prisma.centro.create({
      data: { nombre: 'A', slug: 'a', planId: integral.id },
    });
    const b = await prisma.centro.create({
      data: { nombre: 'B', slug: 'b', planId: basico.id },
    });
    const passwordHash = await hashPassword(CLAVE);
    const usuarios: Record<string, string> = {};
    for (const [email, centroId, rol] of [
      ['admin@a.com', a.id, Rol.admin],
      ['prof1@a.com', a.id, Rol.profesional],
      ['admin@b.com', b.id, Rol.admin],
    ] as const) {
      const u = await prisma.usuario.create({
        data: { email, nombre: email, passwordHash },
      });
      usuarios[email] = u.id;
      await prisma.miembro.create({ data: { centroId, usuarioId: u.id, rol } });
    }
    const prof = async (apellido: string, usuarioId?: string) =>
      (
        await prisma.profesional.create({
          data: {
            centroId: a.id,
            nombre: 'P',
            apellido,
            disciplina: 'Psicología',
            usuarioId,
          },
        })
      ).id;
    ids.p1 = await prof('Uno', usuarios['prof1@a.com']);
    ids.p2 = await prof('Dos');
    ids.osep = (
      await prisma.financiador.create({
        data: { centroId: a.id, nombre: 'OSEP', tipo: 'obra_social' },
      })
    ).id;
    ids.ana = (
      await prisma.paciente.create({
        data: { centroId: a.id, nombre: 'Ana', apellido: 'T' },
      })
    ).id;
    ids.juan = (
      await prisma.paciente.create({
        data: {
          centroId: a.id,
          nombre: 'Juan',
          apellido: 'T',
          financiadorId: ids.osep,
        },
      })
    ).id;

    const { AppModule } = await import('../src/app.module.js');
    const { setupApp } = await import('../src/setup-app.js');
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    setupApp(app);
    await app.init();
    for (const quien of ['admin@a.com', 'prof1@a.com', 'admin@b.com']) {
      tokens[quien] = (
        await http()
          .post('/api/v1/auth/login')
          .send({ email: quien, password: CLAVE })
          .expect(200)
      ).body.accessToken;
    }

    for (const [financiadorId, monto] of [
      [null, 10000],
      [ids.osep, 8000],
    ] as const)
      await http()
        .post('/api/v1/precios')
        .set(como('admin@a.com'))
        .send({ financiadorId, monto, vigenteDesde: '2026-01-01' })
        .expect(201);

    // Octubre: Uno atiende a Ana (presente, presente, ausente sin aviso); Dos a Juan (presente).
    // Noviembre: Uno atiende a Ana (ausente con aviso).
    for (const [pacienteId, profesionalId, fecha, estado] of [
      [ids.ana, ids.p1, '2026-10-05', 'presente'],
      [ids.ana, ids.p1, '2026-10-12', 'presente'],
      [ids.ana, ids.p1, '2026-10-19', 'ausente_sin_aviso'],
      [ids.juan, ids.p2, '2026-10-06', 'presente'],
      [ids.ana, ids.p1, '2026-11-02', 'ausente_con_aviso'],
    ] as const) {
      const t = await http()
        .post('/api/v1/turnos')
        .set(como('admin@a.com'))
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
        .set(como('admin@a.com'))
        .send({ estado })
        .expect(200);
    }
    // Ana pagó una de sus dos sesiones.
    const deAna = await http()
      .get(`/api/v1/prestaciones?pacienteId=${ids.ana}`)
      .set(como('admin@a.com'))
      .expect(200);
    await http()
      .post('/api/v1/pagos/lote')
      .set(como('admin@a.com'))
      .send({ prestacionIds: [deAna.body[0].id], medio: 'efectivo' })
      .expect(201);
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('valida el rango', async () => {
    await http()
      .get(`${R}?desde=2026-11&hasta=2026-10`)
      .set(como('admin@a.com'))
      .expect(400);
    await http()
      .get(`${R}?desde=2024-01&hasta=2026-10`)
      .set(como('admin@a.com'))
      .expect(400);
  });

  it('sin el módulo en el plan, 403', async () => {
    await http()
      .get(`${R}?desde=2026-10&hasta=2026-11`)
      .set(como('admin@b.com'))
      .expect(403);
  });

  it('el admin ve el centro completo por mes, profesional y cobertura', async () => {
    const res = await http()
      .get(`${R}?desde=2026-10&hasta=2026-11`)
      .set(como('admin@a.com'))
      .expect(200);
    const r = res.body;
    expect(r.soloProfesional).toBe(false);
    expect(r.meses.map((m: { mes: string }) => m.mes)).toEqual([
      '2026-10',
      '2026-11',
    ]);
    expect(r.meses[0]).toMatchObject({
      turnos: 4,
      presentes: 3,
      ausentesSinAviso: 1,
      asistencia: 75,
      pacientes: 2,
      facturado: 28000,
      cobrado: 10000,
    });
    expect(r.meses[1]).toMatchObject({
      turnos: 1,
      ausentesConAviso: 1,
      asistencia: 0,
      facturado: 0,
    });
    expect(r.total).toMatchObject({
      turnos: 5,
      presentes: 3,
      asistencia: 60,
      facturado: 28000,
      cobrado: 10000,
      pacientes: 2,
      pacientesNuevos: 2,
    });
    expect(
      r.porProfesional.map(
        (p: { profesional: { apellido: string } }) => p.profesional.apellido,
      ),
    ).toEqual(['Uno', 'Dos']);
    expect(r.porProfesional[0]).toMatchObject({
      presentes: 2,
      facturado: 20000,
      cobrado: 10000,
    });
    expect(r.porCobertura).toEqual([
      { financiador: null, sesiones: 2, facturado: 20000 },
      {
        financiador: { id: ids.osep, nombre: 'OSEP' },
        sesiones: 1,
        facturado: 8000,
      },
    ]);
  });

  it('el profesional ve solo lo suyo', async () => {
    const res = await http()
      .get(`${R}?desde=2026-10&hasta=2026-11`)
      .set(como('prof1@a.com'))
      .expect(200);
    expect(res.body.soloProfesional).toBe(true);
    expect(res.body.total).toMatchObject({
      turnos: 4,
      presentes: 2,
      facturado: 20000,
      pacientesNuevos: null,
    });
    expect(res.body.porProfesional).toHaveLength(1);
  });
});

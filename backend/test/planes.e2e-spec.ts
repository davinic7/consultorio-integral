import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../src/auth/password.js';
import { Modulo, PrismaClient, Rol } from '../src/generated/prisma/client.js';
import { adaptadorPg } from '../src/prisma/adaptador.js';

const url = process.env.TEST_DATABASE_URL;
const CLAVE = 'clave-de-prueba-123';
const BASICO = [Modulo.agenda, Modulo.asistencia, Modulo.pacientes];

describe.skipIf(!url)('Planes y módulos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const como = (quien: string) => ({
    Authorization: `Bearer ${tokens[quien]}`,
  });
  const login = (email: string) =>
    http()
      .post('/api/v1/auth/login')
      .send({ email, password: CLAVE })
      .expect(200);

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.LOGIN_LIMITE_POR_MIN = '1000';
    prisma = new PrismaClient({ adapter: adaptadorPg(url!) });
    await prisma.$executeRawUnsafe(
      'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
    );
    const basico = await prisma.plan.create({
      data: {
        codigo: 'basico',
        nombre: 'Básico',
        precioMensual: 0,
        modulos: { create: BASICO.map((modulo) => ({ modulo })) },
      },
    });
    ids.basico = basico.id;
    ids.integral = (
      await prisma.plan.create({
        data: {
          codigo: 'integral',
          nombre: 'Integral',
          precioMensual: 100,
          modulos: {
            create: Object.values(Modulo).map((modulo) => ({ modulo })),
          },
        },
      })
    ).id;
    const centro = await prisma.centro.create({
      data: { nombre: 'Chico', slug: 'chico', planId: basico.id },
    });
    ids.centro = centro.id;
    const passwordHash = await hashPassword(CLAVE);
    await prisma.usuario.create({
      data: {
        email: 'sa@x.com',
        nombre: 'SA',
        passwordHash,
        esSuperadmin: true,
      },
    });
    const admin = await prisma.usuario.create({
      data: { email: 'admin@chico.com', nombre: 'Admin', passwordHash },
    });
    await prisma.miembro.create({
      data: { centroId: centro.id, usuarioId: admin.id, rol: Rol.admin },
    });

    const { AppModule } = await import('../src/app.module.js');
    const { setupApp } = await import('../src/setup-app.js');
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    setupApp(app);
    await app.init();
    for (const quien of ['sa@x.com', 'admin@chico.com']) {
      tokens[quien] = (await login(quien)).body.accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('la sesión trae el plan y sus módulos', async () => {
    const res = await login('admin@chico.com');
    expect(res.body.centro.plan).toEqual({
      codigo: 'basico',
      nombre: 'Básico',
    });
    expect(res.body.centro.modulos.sort()).toEqual([...BASICO].sort());
  });

  it('sin el módulo en el plan, la API responde 403', async () => {
    const res = await http()
      .get('/api/v1/prestaciones?mes=2026-10')
      .set(como('admin@chico.com'))
      .expect(403);
    expect(res.body.message).toBe('El plan del centro no incluye Cobros');
    await http()
      .get('/api/v1/liquidaciones?mes=2026-10')
      .set(como('admin@chico.com'))
      .expect(403);
    await http()
      .post('/api/v1/financiadores')
      .set(como('admin@chico.com'))
      .send({ nombre: 'OSEP', tipo: 'obra_social' })
      .expect(403);
    // Lo del plan básico funciona, y la lista de obras sociales se puede leer.
    await http()
      .get('/api/v1/pacientes')
      .set(como('admin@chico.com'))
      .expect(200);
    await http()
      .get('/api/v1/turnos?desde=2026-10-01&hasta=2026-10-07')
      .set(como('admin@chico.com'))
      .expect(200);
    await http()
      .get('/api/v1/financiadores')
      .set(como('admin@chico.com'))
      .expect(200);
  });

  it('el superadmin cambia los módulos de un plan y se aplica enseguida', async () => {
    const res = await http()
      .patch(`/api/v1/planes/${ids.basico}`)
      .set(como('sa@x.com'))
      .send({ modulos: [...BASICO, Modulo.cobros] })
      .expect(200);
    expect(res.body.modulos).toContain('cobros');
    await http()
      .get('/api/v1/prestaciones?mes=2026-10')
      .set(como('admin@chico.com'))
      .expect(200);
  });

  it('el superadmin cambia el plan de un centro', async () => {
    const res = await http()
      .patch(`/api/v1/centros/${ids.centro}`)
      .set(como('sa@x.com'))
      .send({ plan: 'integral' })
      .expect(200);
    expect(res.body.plan.codigo).toBe('integral');
    await http()
      .get('/api/v1/liquidaciones?mes=2026-10')
      .set(como('admin@chico.com'))
      .expect(200);
    await http()
      .patch(`/api/v1/centros/${ids.centro}`)
      .set(como('sa@x.com'))
      .send({ plan: 'no-existe' })
      .expect(404);
  });

  it('lista y crea planes; nadie más puede', async () => {
    const lista = await http()
      .get('/api/v1/planes')
      .set(como('sa@x.com'))
      .expect(200);
    expect(lista.body.map((p: { codigo: string }) => p.codigo)).toEqual([
      'basico',
      'integral',
    ]);
    expect(lista.body[1]).toMatchObject({ precioMensual: 100, centros: 1 });
    await http()
      .post('/api/v1/planes')
      .set(como('sa@x.com'))
      .send({
        codigo: 'consultorio',
        nombre: 'Consultorio',
        precioMensual: 15000,
        modulos: ['agenda', 'cobros'],
      })
      .expect(201);
    await http()
      .post('/api/v1/planes')
      .set(como('sa@x.com'))
      .send({ codigo: 'x', nombre: 'X', precioMensual: 0, modulos: ['nada'] })
      .expect(400);
    await http().get('/api/v1/planes').set(como('admin@chico.com')).expect(403);
    await http()
      .patch(`/api/v1/centros/${ids.centro}`)
      .set(como('admin@chico.com'))
      .send({ plan: 'basico' })
      .expect(403);
  });
});

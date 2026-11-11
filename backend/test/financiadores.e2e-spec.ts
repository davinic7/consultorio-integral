import 'dotenv/config';
import { TODOS_LOS_MODULOS } from './ayudas.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../src/auth/password.js';
import { PrismaClient, Rol } from '../src/generated/prisma/client.js';
import { adaptadorPg } from '../src/prisma/adaptador.js';

const url = process.env.TEST_DATABASE_URL;
const CLAVE = 'clave-de-prueba-123';

describe.skipIf(!url)('Financiadores (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const como = (quien: string) => ({
    Authorization: `Bearer ${tokens[quien]}`,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.LOGIN_LIMITE_POR_MIN = '1000';
    prisma = new PrismaClient({ adapter: adaptadorPg(url!) });
    await prisma.$executeRawUnsafe(
      'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
    );
    const plan = await prisma.plan.create({
      data: { codigo: 'basico', nombre: 'Básico', precioMensual: 0, modulos: TODOS_LOS_MODULOS },
    });
    const a = await prisma.centro.create({
      data: { nombre: 'A', slug: 'a', planId: plan.id },
    });
    const b = await prisma.centro.create({
      data: { nombre: 'B', slug: 'b', planId: plan.id },
    });
    const passwordHash = await hashPassword(CLAVE);
    for (const [email, centroId, rol] of [
      ['admin@a.com', a.id, Rol.admin],
      ['recep@a.com', a.id, Rol.recepcion],
      ['admin@b.com', b.id, Rol.admin],
    ] as const) {
      const u = await prisma.usuario.create({
        data: { email, nombre: email, passwordHash },
      });
      await prisma.miembro.create({ data: { centroId, usuarioId: u.id, rol } });
    }
    ids.paciente = (
      await prisma.paciente.create({
        data: { centroId: a.id, nombre: 'Juan', apellido: 'López' },
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
    for (const quien of ['admin@a.com', 'recep@a.com', 'admin@b.com']) {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: quien, password: CLAVE });
      tokens[quien] = res.body.accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('el admin crea una obra social con sus reglas', async () => {
    const res = await http()
      .post('/api/v1/financiadores')
      .set(como('admin@a.com'))
      .send({
        nombre: 'OSEP',
        tipo: 'obra_social',
        codigoPrestacion: '250101',
        requiereOrden: true,
        maxSesionesSemana: 3,
        diasValidezOrden: 30,
      })
      .expect(201);
    ids.osep = res.body.id;
    expect(res.body).toMatchObject({
      nombre: 'OSEP',
      tipo: 'obra_social',
      requiereOrden: true,
      requiereToken: false,
      maxSesionesSemana: 3,
    });
  });

  it('valida las reglas y el nombre repetido', async () => {
    await http()
      .post('/api/v1/financiadores')
      .set(como('admin@a.com'))
      .send({ nombre: 'X', tipo: 'obra_social', maxSesionesSemana: 0 })
      .expect(400);
    await http()
      .post('/api/v1/financiadores')
      .set(como('admin@a.com'))
      .send({ nombre: 'X', tipo: 'otro' })
      .expect(400);
    await http()
      .post('/api/v1/financiadores')
      .set(como('admin@a.com'))
      .send({ nombre: 'OSEP', tipo: 'prepaga' })
      .expect(409);
  });

  it('recepción los ve pero no los crea', async () => {
    const res = await http()
      .get('/api/v1/financiadores')
      .set(como('recep@a.com'))
      .expect(200);
    expect(res.body.map((f: { nombre: string }) => f.nombre)).toEqual([
      'OSEP',
    ]);
    await http()
      .post('/api/v1/financiadores')
      .set(como('recep@a.com'))
      .send({ nombre: 'Otra', tipo: 'prepaga' })
      .expect(403);
  });

  it('otro centro no los ve ni los edita', async () => {
    const res = await http()
      .get('/api/v1/financiadores')
      .set(como('admin@b.com'))
      .expect(200);
    expect(res.body).toEqual([]);
    await http()
      .patch(`/api/v1/financiadores/${ids.osep}`)
      .set(como('admin@b.com'))
      .send({ nombre: 'Hackeada' })
      .expect(404);
  });

  it('el paciente se asocia a la obra social y la ficha trae sus reglas', async () => {
    const res = await http()
      .patch(`/api/v1/pacientes/${ids.paciente}`)
      .set(como('recep@a.com'))
      .send({ financiadorId: ids.osep, nroAfiliado: 'AF-1' })
      .expect(200);
    expect(res.body.financiador).toMatchObject({
      nombre: 'OSEP',
      maxSesionesSemana: 3,
      requiereOrden: true,
    });
  });

  it('una obra social dada de baja no se puede asignar', async () => {
    const baja = await http()
      .post('/api/v1/financiadores')
      .set(como('admin@a.com'))
      .send({ nombre: 'Vieja', tipo: 'obra_social' })
      .expect(201);
    await http()
      .patch(`/api/v1/financiadores/${baja.body.id}`)
      .set(como('admin@a.com'))
      .send({ activo: false })
      .expect(200);
    await http()
      .patch(`/api/v1/pacientes/${ids.paciente}`)
      .set(como('recep@a.com'))
      .send({ financiadorId: baja.body.id })
      .expect(400);
    const res = await http()
      .get('/api/v1/financiadores?incluirInactivos=true')
      .set(como('admin@a.com'))
      .expect(200);
    expect(res.body).toHaveLength(2);
  });
});

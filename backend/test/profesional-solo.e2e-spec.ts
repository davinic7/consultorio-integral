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

/**
 * Profesional que trabaja solo: es admin de su espacio y también atiende
 * (ficha de profesional vinculada), sin recepción.
 */
describe.skipIf(!url)('Profesional que trabaja solo (e2e)', () => {
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
    await prisma.plan.create({
      data: {
        codigo: 'profesional',
        nombre: 'Profesional',
        precioMensual: 0,
        modulos: TODOS_LOS_MODULOS,
      },
    });
    const passwordHash = await hashPassword(CLAVE);
    await prisma.usuario.create({
      data: {
        email: 'sa@x.com',
        nombre: 'SA',
        passwordHash,
        esSuperadmin: true,
      },
    });

    const { AppModule } = await import('../src/app.module.js');
    const { setupApp } = await import('../src/setup-app.js');
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    setupApp(app);
    await app.init();
    tokens.sa = (await login('sa@x.com')).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('el superadmin crea el consultorio con un admin que también atiende', async () => {
    await http()
      .post('/api/v1/centros')
      .set(como('sa'))
      .send({
        nombre: 'Consultorio Lic. Díaz',
        slug: 'lic-diaz',
        plan: 'profesional',
        admin: { email: 'diaz@x.com', nombre: 'Laura Díaz', password: CLAVE },
        atiende: {
          nombre: 'Laura',
          apellido: 'Díaz',
          disciplina: 'Psicología',
        },
      })
      .expect(201);

    const prof = await prisma.profesional.findFirstOrThrow({
      where: { usuario: { email: 'diaz@x.com' } },
    });
    expect(prof).toMatchObject({
      apellido: 'Díaz',
      disciplina: 'Psicología',
      activo: true,
    });
    // Trabaja solo: sin acuerdo de alquiler, no le debe nada al centro.
    expect(
      await prisma.acuerdoAlquiler.count({ where: { profesionalId: prof.id } }),
    ).toBe(0);
    ids.prof = prof.id;
  });

  it('la sesión dice que es admin y que atiende', async () => {
    const res = await login('diaz@x.com');
    tokens.diaz = res.body.accessToken;
    expect(res.body.rol).toBe(Rol.admin);
    expect(res.body.atiende).toBe(true);
    const yo = await http()
      .get('/api/v1/auth/yo')
      .set(como('diaz'))
      .expect(200);
    expect(yo.body.atiende).toBe(true);
  });

  it('carga su paciente y escribe notas de sesión', async () => {
    const pac = await http()
      .post('/api/v1/pacientes')
      .set(como('diaz'))
      .send({
        nombre: 'Tomás',
        apellido: 'Paz',
        dni: '40111222',
        profesionalIds: [ids.prof],
      })
      .expect(201);
    const nota = await http()
      .post(`/api/v1/pacientes/${pac.body.id}/notas`)
      .set(como('diaz'))
      .send({ texto: 'Primera entrevista' })
      .expect(201);
    expect(nota.body).toMatchObject({
      texto: 'Primera entrevista',
      propia: true,
    });
    const lista = await http()
      .get(`/api/v1/pacientes/${pac.body.id}/notas`)
      .set(como('diaz'))
      .expect(200);
    expect(lista.body).toHaveLength(1);
  });

  it('un admin sin ficha de profesional sigue sin poder ver notas', async () => {
    const centro = await prisma.centro.findFirstOrThrow({
      where: { slug: 'lic-diaz' },
    });
    const otro = await prisma.usuario.create({
      data: {
        email: 'admin2@x.com',
        nombre: 'Admin 2',
        passwordHash: await hashPassword(CLAVE),
      },
    });
    await prisma.miembro.create({
      data: { centroId: centro.id, usuarioId: otro.id, rol: Rol.admin },
    });
    const res = await login('admin2@x.com');
    tokens.admin2 = res.body.accessToken;
    expect(res.body.atiende).toBe(false);
    const pac = await prisma.paciente.findFirstOrThrow({
      where: { dni: '40111222' },
    });
    await http()
      .get(`/api/v1/pacientes/${pac.id}/notas`)
      .set(como('admin2'))
      .expect(403);
  });

  it('se puede vincular un admin a una ficha de profesional', async () => {
    const otro = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'admin2@x.com' },
    });
    await http()
      .post('/api/v1/profesionales')
      .set(como('diaz'))
      .send({
        nombre: 'Admin',
        apellido: 'Dos',
        disciplina: 'Fonoaudiología',
        usuarioId: otro.id,
      })
      .expect(201);
    expect((await login('admin2@x.com')).body.atiende).toBe(true);
  });

  it('recepción no se puede vincular a una ficha de profesional', async () => {
    const centro = await prisma.centro.findFirstOrThrow({
      where: { slug: 'lic-diaz' },
    });
    const recep = await prisma.usuario.create({
      data: {
        email: 'recep@x.com',
        nombre: 'Recep',
        passwordHash: await hashPassword(CLAVE),
      },
    });
    await prisma.miembro.create({
      data: { centroId: centro.id, usuarioId: recep.id, rol: Rol.recepcion },
    });
    await http()
      .post('/api/v1/profesionales')
      .set(como('diaz'))
      .send({
        nombre: 'R',
        apellido: 'R',
        disciplina: 'X',
        usuarioId: recep.id,
      })
      .expect(400);
  });
});

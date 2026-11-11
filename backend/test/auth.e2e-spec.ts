import 'dotenv/config';
import { TODOS_LOS_MODULOS } from './ayudas.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { adaptadorPg } from '../src/prisma/adaptador.js';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../src/auth/password.js';
import { PrismaClient, Rol } from '../src/generated/prisma/client.js';

const url = process.env.TEST_DATABASE_URL;
const CLAVE = 'clave-de-prueba-123';

describe.skipIf(!url)('Auth y roles (e2e, PostgreSQL)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let centroA: string;
  let centroB: string;
  let miembroAdminB: string;

  const http = () => request(app.getHttpServer());
  const login = (email: string, extra: Record<string, unknown> = {}) =>
    http()
      .post('/api/v1/auth/login')
      .send({ email, password: CLAVE, ...extra });
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function usuario(email: string, nombre: string, esSuperadmin = false) {
    return prisma.usuario.create({
      data: {
        email,
        nombre,
        esSuperadmin,
        passwordHash: await hashPassword(CLAVE),
      },
    });
  }

  beforeAll(async () => {
    // La app usa la base de tests, y sin límite de login para poder probar.
    process.env.DATABASE_URL = url;
    process.env.LOGIN_LIMITE_POR_MIN = '1000';
    prisma = new PrismaClient({
      adapter: adaptadorPg(url!),
    });
    await prisma.$executeRawUnsafe(
      'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
    );

    const plan = await prisma.plan.create({
      data: { codigo: 'basico', nombre: 'Básico', precioMensual: 0, modulos: TODOS_LOS_MODULOS },
    });
    centroA = (
      await prisma.centro.create({
        data: { nombre: 'A', slug: 'a', planId: plan.id },
      })
    ).id;
    centroB = (
      await prisma.centro.create({
        data: { nombre: 'B', slug: 'b', planId: plan.id },
      })
    ).id;

    await usuario('super@test.com', 'Super', true);
    const adminA = await usuario('admin-a@test.com', 'Admin A');
    const adminB = await usuario('admin-b@test.com', 'Admin B');
    const prof = await usuario('prof@test.com', 'Prof A');
    const multi = await usuario('multi@test.com', 'Multi');
    await prisma.miembro.createMany({
      data: [
        { centroId: centroA, usuarioId: adminA.id, rol: Rol.admin },
        { centroId: centroA, usuarioId: prof.id, rol: Rol.profesional },
        { centroId: centroA, usuarioId: multi.id, rol: Rol.profesional },
        { centroId: centroB, usuarioId: multi.id, rol: Rol.recepcion },
      ],
    });
    miembroAdminB = (
      await prisma.miembro.create({
        data: { centroId: centroB, usuarioId: adminB.id, rol: Rol.admin },
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
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  describe('login', () => {
    it('rechaza contraseña incorrecta y email inexistente con el mismo mensaje', async () => {
      const mal = await http()
        .post('/api/v1/auth/login')
        .send({ email: 'admin-a@test.com', password: 'otra-cosa' })
        .expect(401);
      const inexistente = await login('nadie@test.com').expect(401);
      expect(mal.body.message).toBe(inexistente.body.message);
    });

    it('valida el cuerpo (400)', async () => {
      await http()
        .post('/api/v1/auth/login')
        .send({ email: 'no-es-email', password: 'x' })
        .expect(400);
    });

    it('entra directo al único centro, sin distinguir mayúsculas en el email', async () => {
      const res = await login('Admin-A@Test.com').expect(200);
      expect(res.body.centro.id).toBe(centroA);
      expect(res.body.rol).toBe('admin');
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
    });

    it('con varios centros entra sin centro y después elige', async () => {
      const res = await login('multi@test.com').expect(200);
      expect(res.body.centro).toBeNull();
      expect(res.body.centros.map((c: { slug: string }) => c.slug)).toEqual([
        'a',
        'b',
      ]);

      await http()
        .get('/api/v1/usuarios')
        .set(bearer(res.body.accessToken))
        .expect(403);

      const enB = await http()
        .post('/api/v1/auth/centro')
        .set(bearer(res.body.accessToken))
        .send({ centroId: centroB })
        .expect(200);
      expect(enB.body.centro.id).toBe(centroB);
      expect(enB.body.rol).toBe('recepcion');
    });

    it('no deja entrar a un centro del que no es miembro', async () => {
      await login('admin-a@test.com', { centroId: centroB }).expect(403);
    });
  });

  describe('tokens', () => {
    it('sin token o con token inválido responde 401', async () => {
      await http().get('/api/v1/auth/yo').expect(401);
      await http().get('/api/v1/auth/yo').set(bearer('no.es.jwt')).expect(401);
    });

    it('/auth/yo devuelve usuario, centro y rol', async () => {
      const { body } = await login('prof@test.com').expect(200);
      const yo = await http()
        .get('/api/v1/auth/yo')
        .set(bearer(body.accessToken))
        .expect(200);
      expect(yo.body.usuario.email).toBe('prof@test.com');
      expect(yo.body.rol).toBe('profesional');
    });

    it('rota el refresh token y, si se reutiliza uno viejo, cierra todas las sesiones', async () => {
      const { body: s1 } = await login('prof@test.com').expect(200);
      const { body: s2 } = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: s1.refreshToken })
        .expect(200);
      expect(s2.refreshToken).not.toBe(s1.refreshToken);

      // Reutilizar el viejo: 401 y queda revocado también el nuevo.
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: s1.refreshToken })
        .expect(401);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: s2.refreshToken })
        .expect(401);
    });

    it('logout invalida el refresh token', async () => {
      const { body } = await login('prof@test.com').expect(200);
      await http()
        .post('/api/v1/auth/logout')
        .send({ refreshToken: body.refreshToken })
        .expect(204);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: body.refreshToken })
        .expect(401);
    });
  });

  describe('roles y aislamiento', () => {
    it('el admin ve solo los usuarios de su centro', async () => {
      const { body } = await login('admin-a@test.com').expect(200);
      const res = await http()
        .get('/api/v1/usuarios')
        .set(bearer(body.accessToken))
        .expect(200);
      const emails = res.body
        .map((m: { usuario: { email: string } }) => m.usuario.email)
        .sort();
      expect(emails).toEqual([
        'admin-a@test.com',
        'multi@test.com',
        'prof@test.com',
      ]);
    });

    it('un profesional no puede administrar usuarios', async () => {
      const { body } = await login('prof@test.com').expect(200);
      await http()
        .get('/api/v1/usuarios')
        .set(bearer(body.accessToken))
        .expect(403);
    });

    it('un admin no puede modificar un miembro de otro centro', async () => {
      const { body } = await login('admin-a@test.com').expect(200);
      await http()
        .patch(`/api/v1/usuarios/${miembroAdminB}`)
        .set(bearer(body.accessToken))
        .send({ activo: false })
        .expect(404);
    });

    it('el admin suma personas, sin duplicar, y no puede modificarse a sí mismo', async () => {
      const { body } = await login('admin-a@test.com').expect(200);
      const auth = bearer(body.accessToken);
      const nuevo = await http()
        .post('/api/v1/usuarios')
        .set(auth)
        .send({
          email: 'recep@test.com',
          nombre: 'Recep',
          rol: 'recepcion',
          password: CLAVE,
        })
        .expect(201);
      expect(nuevo.body.rol).toBe('recepcion');
      await login('recep@test.com').expect(200);

      await http()
        .post('/api/v1/usuarios')
        .set(auth)
        .send({ email: 'recep@test.com', nombre: 'Recep', rol: 'admin' })
        .expect(409);

      await http()
        .post('/api/v1/usuarios')
        .set(auth)
        .send({ email: 'sin-clave@test.com', nombre: 'X', rol: 'recepcion' })
        .expect(400);

      const lista = await http().get('/api/v1/usuarios').set(auth).expect(200);
      const yo = lista.body.find(
        (m: { usuario: { email: string } }) =>
          m.usuario.email === 'admin-a@test.com',
      );
      await http()
        .patch(`/api/v1/usuarios/${yo.id}`)
        .set(auth)
        .send({ rol: 'recepcion' })
        .expect(403);
    });

    it('al desactivar un miembro, su sesión en el centro ya no se renueva', async () => {
      const { body: recep } = await login('recep@test.com').expect(200);
      const { body: admin } = await login('admin-a@test.com').expect(200);
      const lista = await http()
        .get('/api/v1/usuarios')
        .set(bearer(admin.accessToken))
        .expect(200);
      const m = lista.body.find(
        (x: { usuario: { email: string } }) =>
          x.usuario.email === 'recep@test.com',
      );
      await http()
        .patch(`/api/v1/usuarios/${m.id}`)
        .set(bearer(admin.accessToken))
        .send({ activo: false })
        .expect(200);
      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: recep.refreshToken })
        .expect(401);
    });
  });

  describe('superadmin', () => {
    it('crea un centro con su primer admin, que puede entrar', async () => {
      const { body } = await login('super@test.com').expect(200);
      expect(body.usuario.esSuperadmin).toBe(true);
      expect(body.centro).toBeNull();
      await http()
        .post('/api/v1/centros')
        .set(bearer(body.accessToken))
        .send({
          nombre: 'Centro Nuevo',
          slug: 'centro-nuevo',
          plan: 'basico',
          admin: {
            email: 'admin-nuevo@test.com',
            nombre: 'Admin Nuevo',
            password: CLAVE,
          },
        })
        .expect(201);
      const nuevo = await login('admin-nuevo@test.com').expect(200);
      expect(nuevo.body.centro.slug).toBe('centro-nuevo');
      expect(nuevo.body.rol).toBe('admin');
    });

    it('rechaza slugs repetidos y planes inexistentes', async () => {
      const { body } = await login('super@test.com').expect(200);
      const base = {
        nombre: 'X',
        admin: { email: 'admin-a@test.com', nombre: 'A' },
      };
      await http()
        .post('/api/v1/centros')
        .set(bearer(body.accessToken))
        .send({ ...base, slug: 'centro-nuevo', plan: 'basico' })
        .expect(409);
      await http()
        .post('/api/v1/centros')
        .set(bearer(body.accessToken))
        .send({ ...base, slug: 'otro', plan: 'no-existe' })
        .expect(400);
    });

    it('nadie más puede gestionar centros, ni siquiera un admin', async () => {
      const { body } = await login('admin-a@test.com').expect(200);
      await http()
        .get('/api/v1/centros')
        .set(bearer(body.accessToken))
        .expect(403);
    });

    it('el superadmin sin centro no accede a datos de un centro', async () => {
      const { body } = await login('super@test.com').expect(200);
      await http()
        .get('/api/v1/usuarios')
        .set(bearer(body.accessToken))
        .expect(403);
    });
  });
});

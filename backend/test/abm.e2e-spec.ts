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

describe.skipIf(!url)('ABM de salas, profesionales y pacientes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  let usuarioProfId: string;

  const http = () => request(app.getHttpServer());
  const como = (quien: string) => ({
    Authorization: `Bearer ${tokens[quien]}`,
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.LOGIN_LIMITE_POR_MIN = '1000';
    prisma = new PrismaClient({
      adapter: adaptadorPg(url!),
    });
    await prisma.$executeRawUnsafe(
      'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
    );

    const plan = await prisma.plan.create({
      data: {
        codigo: 'basico',
        nombre: 'Básico',
        precioMensual: 0,
        modulos: TODOS_LOS_MODULOS,
      },
    });
    const a = await prisma.centro.create({
      data: { nombre: 'A', slug: 'a', planId: plan.id },
    });
    const b = await prisma.centro.create({
      data: { nombre: 'B', slug: 'b', planId: plan.id },
    });
    const passwordHash = await hashPassword(CLAVE);
    const crear = async (email: string, centroId: string, rol: Rol) => {
      const u = await prisma.usuario.create({
        data: { email, nombre: email, passwordHash },
      });
      await prisma.miembro.create({ data: { centroId, usuarioId: u.id, rol } });
      return u;
    };
    await crear('admin@a.com', a.id, Rol.admin);
    await crear('recep@a.com', a.id, Rol.recepcion);
    usuarioProfId = (await crear('prof@a.com', a.id, Rol.profesional)).id;
    await crear('prof2@a.com', a.id, Rol.profesional);
    await crear('admin@b.com', b.id, Rol.admin);

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
      'prof@a.com',
      'prof2@a.com',
      'admin@b.com',
    ]) {
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

  describe('salas', () => {
    let salaId: string;

    it('el admin crea salas y no se repite el nombre', async () => {
      const res = await http()
        .post('/api/v1/salas')
        .set(como('admin@a.com'))
        .send({ nombre: 'Sala 1', descripcion: 'Planta baja' })
        .expect(201);
      salaId = res.body.id;
      const repetida = await http()
        .post('/api/v1/salas')
        .set(como('admin@a.com'))
        .send({ nombre: 'Sala 1' })
        .expect(409);
      expect(repetida.body.message).toContain('nombre');
    });

    it('recepción y profesionales ven las salas pero no las crean', async () => {
      await http()
        .post('/api/v1/salas')
        .set(como('recep@a.com'))
        .send({ nombre: 'X' })
        .expect(403);
      const res = await http()
        .get('/api/v1/salas')
        .set(como('prof@a.com'))
        .expect(200);
      expect(res.body.map((s: { nombre: string }) => s.nombre)).toEqual([
        'Sala 1',
      ]);
    });

    it('la baja oculta la sala del listado por defecto', async () => {
      await http()
        .patch(`/api/v1/salas/${salaId}`)
        .set(como('admin@a.com'))
        .send({ activa: false })
        .expect(200);
      expect(
        (await http().get('/api/v1/salas').set(como('admin@a.com'))).body,
      ).toEqual([]);
      const todas = await http()
        .get('/api/v1/salas?incluirInactivas=true')
        .set(como('admin@a.com'))
        .expect(200);
      expect(todas.body).toHaveLength(1);
    });

    it('otro centro no ve ni modifica la sala', async () => {
      expect(
        (
          await http()
            .get('/api/v1/salas?incluirInactivas=true')
            .set(como('admin@b.com'))
        ).body,
      ).toEqual([]);
      await http()
        .patch(`/api/v1/salas/${salaId}`)
        .set(como('admin@b.com'))
        .send({ activa: true })
        .expect(404);
    });
  });

  describe('profesionales', () => {
    let profId: string;

    it('el admin crea un profesional vinculado a su usuario', async () => {
      const res = await http()
        .post('/api/v1/profesionales')
        .set(como('admin@a.com'))
        .send({
          nombre: 'Pablo',
          apellido: 'Pérez',
          disciplina: 'Psicología',
          usuarioId: usuarioProfId,
        })
        .expect(201);
      profId = res.body.id;
      expect(res.body.usuarioId).toBe(usuarioProfId);
    });

    it('no vincula usuarios que no son profesionales del centro', async () => {
      const admin = await prisma.usuario.findUniqueOrThrow({
        where: { email: 'recep@a.com' },
      });
      await http()
        .post('/api/v1/profesionales')
        .set(como('admin@a.com'))
        .send({
          nombre: 'X',
          apellido: 'Y',
          disciplina: 'Z',
          usuarioId: admin.id,
        })
        .expect(400);
    });

    it('el acuerdo de alquiler solo lo ven el admin y el propio profesional', async () => {
      await http()
        .put(`/api/v1/profesionales/${profId}/acuerdos/2026-01`)
        .set(como('admin@a.com'))
        .send({ porcentaje: 40 })
        .expect(200);
      await http()
        .get(`/api/v1/profesionales/${profId}/acuerdos`)
        .set(como('recep@a.com'))
        .expect(403);
      const propio = await http()
        .get(`/api/v1/profesionales/${profId}/acuerdos`)
        .set(como('prof@a.com'))
        .expect(200);
      expect(propio.body[0]).toMatchObject({
        vigenteDesde: '2026-01',
        porcentaje: 40,
      });
      // El profesional no lo cambia.
      await http()
        .put(`/api/v1/profesionales/${profId}/acuerdos/2026-02`)
        .set(como('prof@a.com'))
        .send({ porcentaje: 0 })
        .expect(403);
    });

    it('otro centro no lo ve', async () => {
      await http()
        .get(`/api/v1/profesionales/${profId}`)
        .set(como('admin@b.com'))
        .expect(404);
    });
  });

  describe('pacientes', () => {
    let profId: string;
    let pacienteId: string;

    beforeAll(async () => {
      const lista = await http()
        .get('/api/v1/profesionales')
        .set(como('admin@a.com'));
      profId = lista.body[0].id;
    });

    it('recepción crea un paciente y se lo asigna a un profesional', async () => {
      const res = await http()
        .post('/api/v1/pacientes')
        .set(como('recep@a.com'))
        .send({
          nombre: 'Juana',
          apellido: 'Gómez',
          dni: '30.111.222',
          telefono: '3834 555123',
          fechaNacimiento: '2015-03-20',
          responsableNombre: 'María Gómez',
          tieneCud: true,
          cudVencimiento: '2027-01-31',
          profesionalIds: [profId],
        })
        .expect(201);
      pacienteId = res.body.id;
      expect(res.body.dni).toBe('30111222');
      expect(res.body.fechaNacimiento).toBe('2015-03-20');
      expect(res.body.profesionales.map((p: { id: string }) => p.id)).toEqual([
        profId,
      ]);
    });

    it('rechaza DNI repetido en el centro', async () => {
      await http()
        .post('/api/v1/pacientes')
        .set(como('recep@a.com'))
        .send({ nombre: 'Otra', apellido: 'Persona', dni: '30111222' })
        .expect(409);
    });

    it('valida CUD: vencimiento solo si tiene CUD', async () => {
      await http()
        .post('/api/v1/pacientes')
        .set(como('recep@a.com'))
        .send({ nombre: 'A', apellido: 'B', cudVencimiento: '2027-01-01' })
        .expect(400);
      // Al sacar el CUD, se borra el vencimiento.
      const res = await http()
        .patch(`/api/v1/pacientes/${pacienteId}`)
        .set(como('recep@a.com'))
        .send({ tieneCud: false })
        .expect(200);
      expect(res.body.cudVencimiento).toBeNull();
    });

    it('busca por apellido, DNI con puntos o teléfono', async () => {
      await http()
        .post('/api/v1/pacientes')
        .set(como('admin@a.com'))
        .send({ nombre: 'Carlos', apellido: 'Díaz', dni: '40222333' })
        .expect(201);
      const buscar = async (q: string) =>
        (
          await http()
            .get('/api/v1/pacientes')
            .query({ q })
            .set(como('recep@a.com'))
            .expect(200)
        ).body;

      expect(
        (await buscar('gómez')).items.map((p: { nombre: string }) => p.nombre),
      ).toEqual(['Juana']);
      expect((await buscar('30.111')).total).toBe(1);
      expect((await buscar('555123')).total).toBe(1);
      expect((await buscar('juana gom')).total).toBe(1);
      expect((await buscar('')).total).toBe(2);
    });

    it('pagina los resultados', async () => {
      const res = await http()
        .get('/api/v1/pacientes?porPagina=1&pagina=2')
        .set(como('recep@a.com'))
        .expect(200);
      expect(res.body).toMatchObject({ total: 2, pagina: 2, porPagina: 1 });
      expect(res.body.items).toHaveLength(1);
    });

    it('un profesional ve solo sus pacientes y no puede editarlos', async () => {
      const propios = await http()
        .get('/api/v1/pacientes')
        .set(como('prof@a.com'))
        .expect(200);
      expect(
        propios.body.items.map((p: { nombre: string }) => p.nombre),
      ).toEqual(['Juana']);
      await http()
        .get(`/api/v1/pacientes/${pacienteId}`)
        .set(como('prof@a.com'))
        .expect(200);

      // prof2 no tiene ficha de profesional: no ve pacientes.
      expect(
        (await http().get('/api/v1/pacientes').set(como('prof2@a.com'))).body
          .total,
      ).toBe(0);
      await http()
        .get(`/api/v1/pacientes/${pacienteId}`)
        .set(como('prof2@a.com'))
        .expect(404);

      await http()
        .patch(`/api/v1/pacientes/${pacienteId}`)
        .set(como('prof@a.com'))
        .send({ nombre: 'X' })
        .expect(403);
    });

    it('reasigna profesionales', async () => {
      await http()
        .put(`/api/v1/pacientes/${pacienteId}/profesionales`)
        .set(como('admin@a.com'))
        .send({ profesionalIds: [] })
        .expect(204);
      expect(
        (await http().get('/api/v1/pacientes').set(como('prof@a.com'))).body
          .total,
      ).toBe(0);
      await http()
        .put(`/api/v1/pacientes/${pacienteId}/profesionales`)
        .set(como('admin@a.com'))
        .send({ profesionalIds: [profId, profId] })
        .expect(204);
      expect(
        (await http().get('/api/v1/pacientes').set(como('prof@a.com'))).body
          .total,
      ).toBe(1);
    });

    it('no asigna profesionales de otro centro', async () => {
      const b = await http()
        .post('/api/v1/profesionales')
        .set(como('admin@b.com'))
        .send({ nombre: 'B', apellido: 'B', disciplina: 'B' })
        .expect(201);
      await http()
        .put(`/api/v1/pacientes/${pacienteId}/profesionales`)
        .set(como('admin@a.com'))
        .send({ profesionalIds: [b.body.id] })
        .expect(400);
    });

    it('otro centro no ve el paciente', async () => {
      await http()
        .get(`/api/v1/pacientes/${pacienteId}`)
        .set(como('admin@b.com'))
        .expect(404);
      expect(
        (await http().get('/api/v1/pacientes').set(como('admin@b.com'))).body
          .total,
      ).toBe(0);
    });
  });
});

import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../src/auth/password.js';
import { Modulo, PrismaClient, Rol } from '../src/generated/prisma/client.js';
import { adaptadorPg } from '../src/prisma/adaptador.js';
import { TODOS_LOS_MODULOS } from './ayudas.js';
import {
  type ClaveJwk,
  cifrarComoElNavegador,
  wavDePrueba,
} from './dictado-navegador.js';

const url = process.env.TEST_DATABASE_URL;
const CLAVE = 'clave-de-prueba-123';

describe.skipIf(!url)('Dictado (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const claves: Record<number, ClaveJwk> = {};

  const http = () => request(app.getHttpServer());
  const como = (quien: string) => ({
    Authorization: `Bearer ${tokens[quien]}`,
  });

  /** Grabación cifrada como la arma el navegador, para un paciente. */
  const paquete = (version: number, pacienteId = ids.juan, segundos = 2) =>
    cifrarComoElNavegador(
      wavDePrueba(segundos),
      claves[version],
      version,
      `dictado:${ids.centroA}:${ids.usuarioProf1}:${pacienteId}`,
    );

  const subir = (quien: string, cuerpo: Uint8Array, pacienteId = ids.juan) =>
    http()
      .post(`/api/v1/pacientes/${pacienteId}/dictados`)
      .set(como(quien))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from(cuerpo));

  async function esperarFin(id: string, quien = 'prof1@a.com') {
    for (let i = 0; i < 200; i++) {
      const r = await http()
        .get(`/api/v1/dictados/${id}`)
        .set(como(quien))
        .expect(200);
      if (r.body.estado === 'listo' || r.body.estado === 'error') return r.body;
      await new Promise((res) => setTimeout(res, 50));
    }
    throw new Error('El dictado no terminó');
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.LOGIN_LIMITE_POR_MIN = '1000';
    process.env.DICTADO_SUBIDAS_POR_MIN = '1000';
    prisma = new PrismaClient({ adapter: adaptadorPg(url!) });
    await prisma.$executeRawUnsafe(
      'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
    );

    const plan = await prisma.plan.create({
      data: {
        codigo: 'full',
        nombre: 'Full',
        precioMensual: 0,
        modulos: TODOS_LOS_MODULOS,
      },
    });
    const sinDictado = await prisma.plan.create({
      data: {
        codigo: 'sin-dictado',
        nombre: 'Sin dictado',
        precioMensual: 0,
        modulos: {
          create: Object.values(Modulo)
            .filter((m) => m !== Modulo.dictado)
            .map((modulo) => ({ modulo })),
        },
      },
    });
    const a = await prisma.centro.create({
      data: { nombre: 'Centro A', slug: 'a', planId: plan.id },
    });
    const b = await prisma.centro.create({
      data: { nombre: 'Centro B', slug: 'b', planId: plan.id },
    });
    const c = await prisma.centro.create({
      data: { nombre: 'Centro C', slug: 'c', planId: sinDictado.id },
    });
    ids.centroA = a.id;

    const passwordHash = await hashPassword(CLAVE);
    const usuario = async (email: string, centroId: string, rol: Rol) => {
      const u = await prisma.usuario.create({
        data: { email, nombre: email, passwordHash },
      });
      await prisma.miembro.create({ data: { centroId, usuarioId: u.id, rol } });
      return u.id;
    };
    const ficha = async (centroId: string, usuarioId: string) =>
      (
        await prisma.profesional.create({
          data: {
            centroId,
            nombre: 'Pro',
            apellido: 'Test',
            disciplina: 'Fonoaudiología',
            usuarioId,
          },
        })
      ).id;
    const paciente = async (centroId: string, nombre: string) =>
      (
        await prisma.paciente.create({
          data: { centroId, nombre, apellido: 'Test' },
        })
      ).id;

    ids.usuarioProf1 = await usuario('prof1@a.com', a.id, Rol.profesional);
    const usuarioProf2 = await usuario('prof2@a.com', a.id, Rol.profesional);
    await usuario('recep@a.com', a.id, Rol.recepcion);
    await usuario('admin@a.com', a.id, Rol.admin);
    await usuario('admin@b.com', b.id, Rol.admin);
    const usuarioProfC = await usuario('prof@c.com', c.id, Rol.profesional);
    ids.p1 = await ficha(a.id, ids.usuarioProf1);
    await ficha(a.id, usuarioProf2);
    const profC = await ficha(c.id, usuarioProfC);
    ids.juan = await paciente(a.id, 'Juan');
    ids.ana = await paciente(a.id, 'Ana');
    ids.pacienteC = await paciente(c.id, 'Carla');
    for (const pacienteId of [ids.juan, ids.ana]) {
      await prisma.pacienteProfesional.create({
        data: { centroId: a.id, pacienteId, profesionalId: ids.p1 },
      });
    }
    await prisma.pacienteProfesional.create({
      data: { centroId: c.id, pacienteId: ids.pacienteC, profesionalId: profC },
    });

    const { AppModule } = await import('../src/app.module.js');
    const { setupApp } = await import('../src/setup-app.js');
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    setupApp(app);
    await app.init();

    for (const quien of [
      'prof1@a.com',
      'prof2@a.com',
      'recep@a.com',
      'admin@a.com',
      'admin@b.com',
      'prof@c.com',
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

  it('entrega la clave pública vigente y la renueva conservando las anteriores', async () => {
    const primera = await http()
      .get('/api/v1/dictados/clave')
      .set(como('prof1@a.com'))
      .expect(200);
    expect(primera.body).toMatchObject({
      version: 1,
      clave: { kty: 'EC', crv: 'P-256' },
    });
    expect(primera.body.clave.d).toBeUndefined();
    claves[1] = primera.body.clave;
    const otraVez = await http()
      .get('/api/v1/dictados/clave')
      .set(como('prof1@a.com'))
      .expect(200);
    expect(otraVez.body.version).toBe(1);

    const fila = await prisma.claveDictado.findFirstOrThrow({
      where: { usuarioId: ids.usuarioProf1 },
    });
    expect(fila.privada.startsWith('v1:')).toBe(true);

    const nueva = await http()
      .post('/api/v1/dictados/clave/renovar')
      .set(como('prof1@a.com'))
      .expect(201);
    expect(nueva.body.version).toBe(2);
    claves[2] = nueva.body.clave;
    const vigente = await http()
      .get('/api/v1/dictados/clave')
      .set(como('prof1@a.com'))
      .expect(200);
    expect(vigente.body.version).toBe(2);
    expect(
      await prisma.claveDictado.count({
        where: { usuarioId: ids.usuarioProf1 },
      }),
    ).toBe(2);
  });

  it('transcribe una grabación cifrada y suma el texto al borrador del paciente', async () => {
    const res = await subir('prof1@a.com', await paquete(2)).expect(202);
    expect(res.body).toMatchObject({ estado: 'en_cola', duracionSeg: 2 });
    const fin = await esperarFin(res.body.id);
    expect(fin).toMatchObject({
      estado: 'listo',
      sinTexto: false,
      codigo: null,
    });
    expect(JSON.stringify(fin)).not.toContain('Texto de prueba');

    const borrador = await http()
      .get(`/api/v1/pacientes/${ids.juan}/notas/borrador`)
      .set(como('prof1@a.com'))
      .expect(200);
    expect(borrador.body.borrador).toMatchObject({ origen: 'dictada' });
    expect(borrador.body.borrador.texto).toMatch(
      /^Texto de prueba del dictado/,
    );
    const fila = await prisma.borradorNota.findFirstOrThrow({
      where: { pacienteId: ids.juan },
    });
    expect(fila.texto).not.toContain('prueba');

    await http()
      .delete(`/api/v1/dictados/${res.body.id}`)
      .set(como('prof1@a.com'))
      .expect(204);
    await http()
      .get(`/api/v1/dictados/${res.body.id}`)
      .set(como('prof1@a.com'))
      .expect(404);
  });

  it('lo grabado con la clave anterior se sigue abriendo y se suma al final', async () => {
    const res = await subir('prof1@a.com', await paquete(1)).expect(202);
    expect((await esperarFin(res.body.id)).estado).toBe('listo');
    const borrador = await http()
      .get(`/api/v1/pacientes/${ids.juan}/notas/borrador`)
      .set(como('prof1@a.com'))
      .expect(200);
    expect(borrador.body.borrador.texto.split('\n\n')).toHaveLength(2);
  });

  it('rechaza lo que no se puede abrir', async () => {
    const alterado = (await paquete(2)).slice();
    alterado[alterado.length - 30] ^= 1;
    await subir('prof1@a.com', alterado).expect(400);
    // Cifrado para otra paciente: no se puede presentar para Juan.
    await subir('prof1@a.com', await paquete(2, ids.ana)).expect(400);
    const versionInexistente = (await paquete(2)).slice();
    new DataView(versionInexistente.buffer).setUint32(5, 99);
    await subir('prof1@a.com', versionInexistente).expect(400);
    await http()
      .post(`/api/v1/pacientes/${ids.juan}/dictados`)
      .set(como('prof1@a.com'))
      .set('Content-Type', 'audio/wav')
      .send(Buffer.from(wavDePrueba(1)))
      .expect(415);
    await subir('prof1@a.com', await paquete(2, ids.juan, 0.2)).expect(400);
  });

  it('pone tope al tamaño de la subida', async () => {
    await subir('prof1@a.com', new Uint8Array(20 * 1024 * 1024)).expect(413);
  });

  it('solo dicta quien escribe notas y atiende al paciente', async () => {
    await http()
      .get('/api/v1/dictados/clave')
      .set(como('recep@a.com'))
      .expect(403);
    await subir('recep@a.com', await paquete(2)).expect(403);
    await http()
      .get('/api/v1/dictados/clave')
      .set(como('admin@a.com'))
      .expect(403);
    await subir('prof2@a.com', await paquete(2)).expect(404);
  });

  it('cada dictado lo ve solo quien lo mandó, en su centro', async () => {
    const res = await subir(
      'prof1@a.com',
      await paquete(2, ids.ana),
      ids.ana,
    ).expect(202);
    await http()
      .get(`/api/v1/dictados/${res.body.id}`)
      .set(como('prof2@a.com'))
      .expect(404);
    await http()
      .get(`/api/v1/dictados/${res.body.id}`)
      .set(como('admin@b.com'))
      .expect(404);
    await http()
      .delete(`/api/v1/dictados/${res.body.id}`)
      .set(como('prof2@a.com'))
      .expect(404);
    expect((await esperarFin(res.body.id)).estado).toBe('listo');
  });

  it('sin el módulo dictado en el plan, no hay dictado', async () => {
    await http()
      .get('/api/v1/dictados/estado')
      .set(como('prof@c.com'))
      .expect(403);
    await http()
      .post(`/api/v1/pacientes/${ids.pacienteC}/dictados`)
      .set(como('prof@c.com'))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from([1, 2, 3]))
      .expect(403);
  });

  it('informa si el dictado está disponible y el máximo por tramo', async () => {
    const res = await http()
      .get('/api/v1/dictados/estado')
      .set(como('prof1@a.com'))
      .expect(200);
    expect(res.body).toEqual({ disponible: true, maxSegundos: 600 });
  });
});

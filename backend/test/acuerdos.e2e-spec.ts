import 'dotenv/config';
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
import { TODOS_LOS_MODULOS } from './ayudas.js';

const url = process.env.TEST_DATABASE_URL;
const CLAVE = 'clave-de-prueba-123';

/**
 * Acuerdos de alquiler en la liquidación: cada tipo, el cambio de vigencia entre
 * meses, quién cobra y que los meses cerrados no cambien.
 */
describe.skipIf(!url)('Acuerdos de alquiler (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  let token: string;
  let tokenProf: string;
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const admin = () => ({ Authorization: `Bearer ${token}` });
  const acuerdo = (mes: string, body: object) =>
    http()
      .put(`/api/v1/profesionales/${ids.prof}/acuerdos/${mes}`)
      .set(admin())
      .send(body);
  const liquidacion = async (mes: string) =>
    (
      await http()
        .get(`/api/v1/liquidaciones?mes=${mes}`)
        .set(admin())
        .expect(200)
    ).body.find(
      (t: { profesional: { id: string } }) => t.profesional.id === ids.prof,
    );

  /** Sesión atendida (turno presente + prestación) de 45 minutos, con o sin sala. */
  async function sesion(dia: string, monto: number, conSala = true) {
    const inicio = new Date(`${dia}T13:00:00Z`);
    const turno = await prisma.turno.create({
      data: {
        centroId: ids.centro,
        pacienteId: ids.paciente,
        profesionalId: ids.prof,
        salaId: conSala ? ids.sala : null,
        inicio,
        fin: new Date(inicio.getTime() + 45 * 60_000),
        estadoAsistencia: EstadoAsistencia.presente,
      },
    });
    await prisma.prestacion.create({
      data: {
        centroId: ids.centro,
        turnoId: turno.id,
        pacienteId: ids.paciente,
        profesionalId: ids.prof,
        fecha: new Date(`${dia}T00:00:00Z`),
        periodo: new Date(`${dia.slice(0, 7)}-01T00:00:00Z`),
        monto,
      },
    });
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.LOGIN_LIMITE_POR_MIN = '1000';
    prisma = new PrismaClient({ adapter: adaptadorPg(url!) });
    await prisma.$executeRawUnsafe(
      'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
    );
    const plan = await prisma.plan.create({
      data: {
        codigo: 'cen',
        nombre: 'Centro',
        precioMensual: 0,
        modulos: TODOS_LOS_MODULOS,
      },
    });
    const centro = await prisma.centro.create({
      data: { nombre: 'C', slug: 'c', planId: plan.id },
    });
    ids.centro = centro.id;
    const passwordHash = await hashPassword(CLAVE);
    const u = await prisma.usuario.create({
      data: { email: 'admin@c.com', nombre: 'Admin', passwordHash },
    });
    const up = await prisma.usuario.create({
      data: { email: 'prof@c.com', nombre: 'Prof', passwordHash },
    });
    await prisma.miembro.createMany({
      data: [
        { centroId: centro.id, usuarioId: u.id, rol: Rol.admin },
        { centroId: centro.id, usuarioId: up.id, rol: Rol.profesional },
      ],
    });
    ids.prof = (
      await prisma.profesional.create({
        data: {
          centroId: centro.id,
          usuarioId: up.id,
          nombre: 'Pía',
          apellido: 'Luna',
          disciplina: 'Psicología',
        },
      })
    ).id;
    ids.sala = (
      await prisma.sala.create({ data: { centroId: centro.id, nombre: 'S1' } })
    ).id;
    ids.paciente = (
      await prisma.paciente.create({
        data: { centroId: centro.id, nombre: 'Ana', apellido: 'Paz' },
      })
    ).id;
    // Precio particular general: 10000 desde siempre.
    await prisma.precio.create({
      data: {
        centroId: centro.id,
        monto: 10_000,
        vigenteDesde: new Date('2000-01-01T00:00:00Z'),
      },
    });
    // Octubre: 4 sesiones de 45 min en sala (3 h) + 1 sin sala = 50000 facturado.
    for (const d of ['06', '13', '20', '27'])
      await sesion(`2026-10-${d}`, 10_000);
    await sesion('2026-10-29', 10_000, false);
    // Noviembre: 2 sesiones en sala.
    await sesion('2026-11-03', 10_000);
    await sesion('2026-11-10', 10_000);

    const { AppModule } = await import('../src/app.module.js');
    const { setupApp } = await import('../src/setup-app.js');
    const modulo = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = modulo.createNestApplication();
    setupApp(app);
    await app.init();
    const login = (email: string) =>
      http()
        .post('/api/v1/auth/login')
        .send({ email, password: CLAVE })
        .expect(200);
    token = (await login('admin@c.com')).body.accessToken;
    tokenProf = (await login('prof@c.com')).body.accessToken;
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('sin acuerdo no hay alquiler: el centro liquida todo lo facturado', async () => {
    expect(await liquidacion('2026-10')).toMatchObject({
      facturado: 50_000,
      alquiler: 0,
      componentes: [],
      saldo: 50_000,
      acuerdo: null,
    });
  });

  it('mixto con todos los componentes, sobre la actividad real del mes', async () => {
    const res = await acuerdo('2026-10', {
      montoFijo: 5_000,
      porcentaje: 10,
      montoPorSesion: 500,
      montoPorHora: 2_000,
      sesionesEquivalentes: 2,
      nota: 'Acuerdo de prueba',
    }).expect(200);
    expect(res.body).toMatchObject({
      vigenteDesde: '2026-10',
      cobraElCentro: true,
      sesionesEquivalentes: 2,
    });
    const l = await liquidacion('2026-10');
    expect(l.componentes).toEqual([
      { tipo: 'fijo', valor: 5_000, base: null, monto: 5_000 },
      { tipo: 'porcentaje', valor: 10, base: 50_000, monto: 5_000 },
      { tipo: 'por_sesion', valor: 500, base: 5, monto: 2_500 },
      { tipo: 'por_hora', valor: 2_000, base: 3, monto: 6_000 },
      {
        tipo: 'sesiones_equivalentes',
        valor: 2,
        base: 10_000,
        monto: 20_000,
      },
    ]);
    expect(l).toMatchObject({
      alquiler: 38_500,
      saldo: 11_500,
      acuerdo: { vigenteDesde: '2026-10', nota: 'Acuerdo de prueba' },
    });
  });

  it('un acuerdo nuevo rige desde su mes; los anteriores siguen con el viejo', async () => {
    await acuerdo('2026-11', {
      montoFijo: 30_000,
      cobraElCentro: false,
    }).expect(200);
    // Noviembre: cobra el profesional, así que el saldo es lo que le debe al centro.
    expect(await liquidacion('2026-11')).toMatchObject({
      facturado: 20_000,
      alquiler: 30_000,
      cobraElCentro: false,
      saldo: -30_000,
      acuerdo: { vigenteDesde: '2026-11' },
    });
    expect((await liquidacion('2026-10')).alquiler).toBe(38_500);
    const historial = await http()
      .get(`/api/v1/profesionales/${ids.prof}/acuerdos`)
      .set(admin())
      .expect(200);
    expect(
      historial.body.map((a: { vigenteDesde: string }) => a.vigenteDesde),
    ).toEqual(['2026-11', '2026-10']);
  });

  it('al cerrar guarda el cálculo; un mes cerrado no admite acuerdos desde él ni antes', async () => {
    const cerrada = await http()
      .post('/api/v1/liquidaciones')
      .set(admin())
      .send({ profesionalId: ids.prof, mes: '2026-10' })
      .expect(201);
    expect(cerrada.body).toMatchObject({
      alquiler: 38_500,
      saldo: 11_500,
      liquidacion: { estado: 'cerrada' },
    });
    const guardada = await prisma.liquidacion.findFirstOrThrow({
      where: { profesionalId: ids.prof },
    });
    expect(guardada.detalleAlquiler).toMatchObject({
      vigenteDesde: '2026-10',
      horasSala: 3,
      precioSesion: 10_000,
    });

    await acuerdo('2026-10', { porcentaje: 50 }).expect(409);
    await acuerdo('2026-09', { porcentaje: 50 }).expect(409);
    await http()
      .delete(`/api/v1/profesionales/${ids.prof}/acuerdos/2026-10`)
      .set(admin())
      .expect(409);
    // Cambiar el acuerdo por la base no altera lo cerrado.
    await prisma.acuerdoAlquiler.updateMany({
      where: { profesionalId: ids.prof, porcentaje: { not: null } },
      data: { porcentaje: 90 },
    });
    expect((await liquidacion('2026-10')).alquiler).toBe(38_500);
    // Un mes posterior al cerrado sí se puede cambiar o borrar.
    await http()
      .delete(`/api/v1/profesionales/${ids.prof}/acuerdos/2026-11`)
      .set(admin())
      .expect(204);
    await acuerdo('2026-12', { montoFijo: 1 }).expect(200);
  });

  it('valida los componentes y solo el admin los carga', async () => {
    await acuerdo('2027-01', { porcentaje: 150 }).expect(400);
    await acuerdo('2027-01', { montoFijo: -1 }).expect(400);
    await acuerdo('2027-01', { sesionesEquivalentes: 0 }).expect(400);
    await http()
      .put(`/api/v1/profesionales/${ids.prof}/acuerdos/mes-malo`)
      .set(admin())
      .send({})
      .expect(400);
    await http()
      .put(`/api/v1/profesionales/${ids.prof}/acuerdos/2027-01`)
      .set({ Authorization: `Bearer ${tokenProf}` })
      .send({ montoFijo: 0 })
      .expect(403);
    // El profesional ve su liquidación con el detalle del alquiler.
    const suya = await http()
      .get('/api/v1/liquidaciones?mes=2026-10')
      .set({ Authorization: `Bearer ${tokenProf}` })
      .expect(200);
    expect(suya.body).toHaveLength(1);
    expect(suya.body[0].componentes).toHaveLength(5);
  });
});

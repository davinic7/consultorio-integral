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

/**
 * Regla de faltazo del profesional: apagada por defecto; sin aviso o con aviso
 * tarde genera un cobro pendiente al particular (nunca a una obra social), que
 * se anula con motivo, entra en la liquidación y se factura solo si se pide.
 */
describe.skipIf(!url)('Faltazos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const como = (quien: string) => ({
    Authorization: `Bearer ${tokens[quien]}`,
  });
  const marcar = (turnoId: string, body: object, quien = 'recep@c.com') =>
    http()
      .post(`/api/v1/turnos/${turnoId}/asistencia`)
      .set(como(quien))
      .send(body);
  const regla = (body: object, quien = 'prof@c.com', prof = ids.prof) =>
    http()
      .put(`/api/v1/profesionales/${prof}/faltazo`)
      .set(como(quien))
      .send(body);
  const delTurno = (turnoId: string) =>
    prisma.prestacion.findFirst({ where: { turnoId } });

  let dia = 1;
  /** Turno ya pasado de octubre, de 10 a 10:45. */
  async function turno(pacienteId = ids.particular) {
    const d = String(dia++).padStart(2, '0');
    const inicio = new Date(`${MES}-${d}T13:00:00Z`);
    return (
      await prisma.turno.create({
        data: {
          centroId: ids.centro,
          pacienteId,
          profesionalId: ids.prof,
          inicio,
          fin: new Date(inicio.getTime() + 45 * 60_000),
        },
      })
    ).id;
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
    const usuario = async (email: string, rol: Rol) => {
      const u = await prisma.usuario.create({
        data: { email, nombre: email, passwordHash },
      });
      await prisma.miembro.create({
        data: { centroId: centro.id, usuarioId: u.id, rol },
      });
      return u.id;
    };
    await usuario('admin@c.com', Rol.admin);
    await usuario('recep@c.com', Rol.recepcion);
    const up = await usuario('prof@c.com', Rol.profesional);
    const uo = await usuario('otro@c.com', Rol.profesional);
    const prof = (nombre: string, usuarioId: string) =>
      prisma.profesional.create({
        data: {
          centroId: centro.id,
          usuarioId,
          nombre,
          apellido: 'X',
          disciplina: 'Psicología',
        },
      });
    ids.prof = (await prof('Pía', up)).id;
    ids.otro = (await prof('Otro', uo)).id;
    ids.particular = (
      await prisma.paciente.create({
        data: {
          centroId: centro.id,
          nombre: 'Ana',
          apellido: 'Paz',
          dni: '30111222',
        },
      })
    ).id;
    const os = await prisma.financiador.create({
      data: { centroId: centro.id, nombre: 'OSEP', tipo: 'obra_social' },
    });
    ids.conObraSocial = (
      await prisma.paciente.create({
        data: {
          centroId: centro.id,
          nombre: 'Beto',
          apellido: 'Sol',
          financiadorId: os.id,
        },
      })
    ).id;
    await prisma.precio.create({
      data: {
        centroId: centro.id,
        monto: 10_000,
        vigenteDesde: new Date('2000-01-01T00:00:00Z'),
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
    for (const email of [
      'admin@c.com',
      'recep@c.com',
      'prof@c.com',
      'otro@c.com',
    ]) {
      tokens[email] = (
        await http()
          .post('/api/v1/auth/login')
          .send({ email, password: CLAVE })
          .expect(200)
      ).body.accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('por defecto la regla está apagada: un faltazo no genera cobro', async () => {
    const r = await http()
      .get(`/api/v1/profesionales/${ids.prof}/faltazo`)
      .set(como('prof@c.com'))
      .expect(200);
    expect(r.body).toEqual({
      activo: false,
      toleranciaHoras: 24,
      modo: 'completa',
      monto: null,
    });
    const t = await turno();
    await marcar(t, { estado: 'ausente_sin_aviso' }).expect(200);
    expect(await delTurno(t)).toBeNull();
  });

  it('la regla la decide el profesional (o la administración); nadie más', async () => {
    await regla({ activo: true }, 'recep@c.com').expect(403);
    await regla({ activo: true }, 'otro@c.com').expect(403);
    await regla({ activo: true, modo: 'fijo' }).expect(400);
    const r = await regla({ activo: true }).expect(200);
    expect(r.body).toMatchObject({ activo: true, toleranciaHoras: 24 });
    await regla({ activo: false }, 'admin@c.com', ids.otro).expect(200);
    // La lista de profesionales dice si está activa (para preguntar al marcar).
    const lista = await http()
      .get('/api/v1/profesionales')
      .set(como('recep@c.com'))
      .expect(200);
    expect(
      lista.body.find((p: { id: string }) => p.id === ids.prof).faltazo,
    ).toEqual({ activo: true, toleranciaHoras: 24 });
  });

  it('sin aviso genera un cobro pendiente por la sesión completa', async () => {
    const t = await turno();
    await marcar(t, { estado: 'ausente_sin_aviso' }).expect(200);
    const p = await delTurno(t);
    expect(p).toMatchObject({ tipo: 'faltazo', financiadorId: null });
    expect(p!.monto.toNumber()).toBe(10_000);
    ids.faltazo = p!.id;
    ids.turnoFaltazo = t;
  });

  it('con aviso: a tiempo no se cobra; tarde, sí', async () => {
    const aTiempo = await turno();
    await marcar(aTiempo, {
      estado: 'ausente_con_aviso',
      avisoTarde: false,
    }).expect(200);
    expect(await delTurno(aTiempo)).toBeNull();
    // Marcado después del turno sin decir cuándo avisó: se toma a tiempo.
    const sinDato = await turno();
    await marcar(sinDato, { estado: 'ausente_con_aviso' }).expect(200);
    expect(await delTurno(sinDato)).toBeNull();

    await regla({ activo: true, modo: 'mitad' }).expect(200);
    const tarde = await turno();
    await marcar(tarde, {
      estado: 'ausente_con_aviso',
      avisoTarde: true,
    }).expect(200);
    const p = await delTurno(tarde);
    expect(p?.tipo).toBe('faltazo');
    expect(p!.monto.toNumber()).toBe(5_000);
    expect(
      (await prisma.turno.findUniqueOrThrow({ where: { id: tarde } }))
        .avisoTarde,
    ).toBe(true);
    ids.faltazoTarde = p!.id;
  });

  it('nunca a una obra social', async () => {
    const t = await turno(ids.conObraSocial);
    await marcar(t, { estado: 'ausente_sin_aviso' }).expect(200);
    expect(await delTurno(t)).toBeNull();
  });

  it('si se corrige a presente, el faltazo pasa a ser la sesión', async () => {
    const t = await turno();
    await marcar(t, { estado: 'ausente_sin_aviso' }).expect(200);
    await marcar(t, { estado: 'presente' }).expect(200);
    const p = await delTurno(t);
    expect(p?.tipo).toBe('sesion');
    expect(p!.monto.toNumber()).toBe(10_000);
  });

  it('se anula con motivo; anulado no se cobra ni se liquida', async () => {
    await http()
      .post(`/api/v1/prestaciones/${ids.faltazoTarde}/anular`)
      .set(como('recep@c.com'))
      .send({ motivo: '' })
      .expect(400);
    await http()
      .post(`/api/v1/prestaciones/${ids.faltazoTarde}/anular`)
      .set(como('otro@c.com'))
      .send({ motivo: 'No corresponde' })
      .expect(403);
    const r = await http()
      .post(`/api/v1/prestaciones/${ids.faltazoTarde}/anular`)
      .set(como('prof@c.com'))
      .send({ motivo: 'Avisó por WhatsApp a tiempo' })
      .expect(200);
    expect(r.body.anulada).toMatchObject({
      motivo: 'Avisó por WhatsApp a tiempo',
    });
    expect(r.body.avisos).toEqual([]);
    await http()
      .post(`/api/v1/prestaciones/${ids.faltazoTarde}/pagos`)
      .set(como('recep@c.com'))
      .send({ medio: 'efectivo' })
      .expect(409);
    await http()
      .post(`/api/v1/prestaciones/${ids.faltazoTarde}/anular`)
      .set(como('recep@c.com'))
      .send({ motivo: 'Otra vez' })
      .expect(409);
    // Una sesión no se anula.
    const sesion = await prisma.prestacion.findFirstOrThrow({
      where: { tipo: 'sesion' },
    });
    await http()
      .post(`/api/v1/prestaciones/${sesion.id}/anular`)
      .set(como('recep@c.com'))
      .send({ motivo: 'Probando' })
      .expect(400);
  });

  it('el faltazo entra en la liquidación: suma a lo facturado, no a las sesiones', async () => {
    const res = await http()
      .get(`/api/v1/liquidaciones?mes=${MES}`)
      .set(como('admin@c.com'))
      .expect(200);
    const l = res.body.find(
      (t: { profesional: { id: string } }) => t.profesional.id === ids.prof,
    );
    // 1 sesión (10000) + 1 faltazo vigente (10000); el anulado no cuenta.
    expect(l).toMatchObject({
      sesiones: 1,
      faltazos: 1,
      montoFaltazos: 10_000,
      facturado: 20_000,
    });
  });

  it('se factura solo si se pide, con su propio ítem', async () => {
    await http()
      .post(`/api/v1/prestaciones/${ids.faltazo}/pagos`)
      .set(como('recep@c.com'))
      .send({ medio: 'efectivo' })
      .expect(201);
    const sin = await http()
      .get(`/api/v1/facturacion/pendientes?mes=${MES}`)
      .set(como('admin@c.com'))
      .expect(200);
    expect(sin.body[0]).toMatchObject({
      faltazos: 1,
      totalFaltazos: 10_000,
      total: 0,
    });
    const con = await http()
      .get(`/api/v1/facturacion/pendientes?mes=${MES}&incluirFaltazos=true`)
      .set(como('admin@c.com'))
      .expect(200);
    expect(con.body[0]).toMatchObject({ total: 10_000 });

    const emitida = await http()
      .post('/api/v1/facturacion/emitir')
      .set(como('admin@c.com'))
      .send({ mes: MES, pacienteIds: [ids.particular], incluirFaltazos: true })
      .expect(200);
    expect(emitida.body.emitidas).toBe(1);
    const factura = await prisma.factura.findFirstOrThrow();
    expect(factura.detalle).toEqual([
      {
        descripcion: 'Sesión no asistida (faltazo)',
        cantidad: 1,
        precio: 10_000,
      },
    ]);
  });
});

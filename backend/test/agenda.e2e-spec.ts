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
// Semana de prueba: lunes 16/11/2026 a domingo 22/11/2026 (Catamarca, UTC−3).
const LUNES = '2026-11-16';
const MARTES = '2026-11-17';

describe.skipIf(!url)('Agenda y avisos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const como = (quien: string) => ({
    Authorization: `Bearer ${tokens[quien]}`,
  });
  const turno = (extra: Record<string, unknown> = {}) => ({
    pacienteId: ids.juan,
    profesionalId: ids.p1,
    salaId: ids.s1,
    fecha: MARTES,
    hora: '10:00',
    duracionMin: 45,
    ...extra,
  });
  const avisosDe = async (quien: string) =>
    (await http().get('/api/v1/avisos').set(como(quien)).expect(200)).body;

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
    const usuario = async (email: string, centroId: string, rol: Rol) => {
      const u = await prisma.usuario.create({
        data: { email, nombre: email, passwordHash },
      });
      await prisma.miembro.create({ data: { centroId, usuarioId: u.id, rol } });
      return u.id;
    };
    await usuario('admin@a.com', a.id, Rol.admin);
    await usuario('recep@a.com', a.id, Rol.recepcion);
    const uProf = await usuario('prof@a.com', a.id, Rol.profesional);
    await usuario('admin@b.com', b.id, Rol.admin);

    ids.p1 = (
      await prisma.profesional.create({
        data: {
          centroId: a.id,
          nombre: 'Pablo',
          apellido: 'Pérez',
          disciplina: 'Psico',
          usuarioId: uProf,
        },
      })
    ).id;
    ids.p2 = (
      await prisma.profesional.create({
        data: {
          centroId: a.id,
          nombre: 'Laura',
          apellido: 'Fernández',
          disciplina: 'Fono',
        },
      })
    ).id;
    ids.s1 = (
      await prisma.sala.create({ data: { centroId: a.id, nombre: 'Sala 1' } })
    ).id;
    ids.s2 = (
      await prisma.sala.create({ data: { centroId: a.id, nombre: 'Sala 2' } })
    ).id;
    ids.juan = (
      await prisma.paciente.create({
        data: { centroId: a.id, nombre: 'Juan', apellido: 'López' },
      })
    ).id;
    ids.ana = (
      await prisma.paciente.create({
        data: { centroId: a.id, nombre: 'Ana', apellido: 'Ruiz' },
      })
    ).id;
    await prisma.pacienteProfesional.create({
      data: { centroId: a.id, pacienteId: ids.juan, profesionalId: ids.p1 },
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
      'admin@a.com',
      'recep@a.com',
      'prof@a.com',
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

  describe('superposición', () => {
    it('crea un turno con fecha y hora del centro', async () => {
      const res = await http()
        .post('/api/v1/turnos')
        .set(como('admin@a.com'))
        .send(turno())
        .expect(201);
      ids.t1 = res.body.id;
      expect(res.body).toMatchObject({
        fecha: MARTES,
        hora: '10:00',
        horaFin: '10:45',
        duracionMin: 45,
        estado: 'pendiente',
        inicio: '2026-11-17T13:00:00.000Z',
      });
      expect(res.body.sala.nombre).toBe('Sala 1');
    });

    it('rechaza la misma sala en horario superpuesto, diciendo con qué choca', async () => {
      const res = await http()
        .post('/api/v1/turnos')
        .set(como('admin@a.com'))
        .send(
          turno({ profesionalId: ids.p2, pacienteId: ids.ana, hora: '10:30' }),
        )
        .expect(409);
      expect(res.body.message).toBe(
        'La sala Sala 1 está ocupada de 10:00 a 10:45',
      );
    });

    it('rechaza al mismo profesional en otra sala a la misma hora', async () => {
      const res = await http()
        .post('/api/v1/turnos')
        .set(como('admin@a.com'))
        .send(turno({ salaId: ids.s2, hora: '10:15' }))
        .expect(409);
      expect(res.body.message).toBe(
        'Pablo Pérez ya tiene un turno de 10:00 a 10:45',
      );
    });

    it('permite turnos contiguos (uno termina cuando empieza el otro)', async () => {
      const res = await http()
        .post('/api/v1/turnos')
        .set(como('admin@a.com'))
        .send(turno({ hora: '10:45' }))
        .expect(201);
      ids.t2 = res.body.id;
    });

    it('un turno cancelado libera el horario', async () => {
      await http()
        .post(`/api/v1/turnos/${ids.t2}/cancelar`)
        .set(como('recep@a.com'))
        .send({ motivo: 'Feriado' })
        .expect(200);
      await http()
        .post('/api/v1/turnos')
        .set(como('admin@a.com'))
        .send(
          turno({ hora: '10:45', profesionalId: ids.p2, pacienteId: ids.ana }),
        )
        .expect(201);
    });

    it('la base frena dos pedidos simultáneos por la misma sala y hora', async () => {
      const pedido = (pacienteId: string, profesionalId: string) =>
        http()
          .post('/api/v1/turnos')
          .set(como('admin@a.com'))
          .send(
            turno({ fecha: LUNES, hora: '15:00', pacienteId, profesionalId }),
          );
      const [r1, r2] = await Promise.all([
        pedido(ids.juan, ids.p1),
        pedido(ids.ana, ids.p2),
      ]);
      expect([r1.status, r2.status].sort((x, y) => x - y)).toEqual([201, 409]);
    });

    it('valida datos y rangos', async () => {
      await http()
        .post('/api/v1/turnos')
        .set(como('admin@a.com'))
        .send(turno({ fecha: '2026-02-30' }))
        .expect(400);
      await http()
        .get('/api/v1/turnos?desde=2026-11-01&hasta=2026-12-31')
        .set(como('admin@a.com'))
        .expect(400);
    });
  });

  describe('el profesional y sus turnos', () => {
    it('ve solo sus turnos', async () => {
      const res = await http()
        .get(`/api/v1/turnos?desde=${LUNES}&hasta=2026-11-22`)
        .set(como('prof@a.com'))
        .expect(200);
      expect(res.body.length).toBeGreaterThan(0);
      expect(
        res.body.every(
          (t: { profesional: { id: string } }) => t.profesional.id === ids.p1,
        ),
      ).toBe(true);
    });

    it('ve la ocupación de salas sin datos de pacientes', async () => {
      const res = await http()
        .get(`/api/v1/turnos/ocupacion?desde=${MARTES}&hasta=${MARTES}`)
        .set(como('prof@a.com'))
        .expect(200);
      expect(
        res.body.some(
          (o: { profesionalId: string }) => o.profesionalId === ids.p2,
        ),
      ).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('Ana');
    });

    it('agenda un turno propio y admin y recepción reciben un aviso', async () => {
      const res = await http()
        .post('/api/v1/turnos')
        .set(como('prof@a.com'))
        .send(turno({ fecha: '2026-11-18', hora: '09:00', salaId: ids.s2 }))
        .expect(201);
      ids.t3 = res.body.id;

      for (const quien of ['admin@a.com', 'recep@a.com']) {
        const { items, noLeidos } = await avisosDe(quien);
        expect(noLeidos).toBe(1);
        expect(items[0]).toMatchObject({
          tipo: 'turno_creado',
          turnoId: ids.t3,
        });
        expect(items[0].mensaje).toBe(
          'Pablo Pérez agendó un turno con Juan López el mié 18/11 09:00 en Sala 2.',
        );
      }
      expect((await avisosDe('prof@a.com')).noLeidos).toBe(0);
    });

    it('mueve y cancela sus turnos, y cada cambio avisa', async () => {
      await http()
        .patch(`/api/v1/turnos/${ids.t3}`)
        .set(como('prof@a.com'))
        .send({ hora: '11:30' })
        .expect(200);
      let { items } = await avisosDe('admin@a.com');
      expect(items[0].mensaje).toBe(
        'Pablo Pérez movió el turno de Juan López del mié 18/11 09:00 al mié 18/11 11:30.',
      );

      await http()
        .post(`/api/v1/turnos/${ids.t3}/cancelar`)
        .set(como('prof@a.com'))
        .send({ motivo: 'Congreso' })
        .expect(200);
      ({ items } = await avisosDe('recep@a.com'));
      expect(items[0]).toMatchObject({ tipo: 'turno_cancelado' });
      expect(items[0].mensaje).toContain(
        'canceló el turno de Juan López del mié 18/11 11:30: Congreso',
      );
    });

    it('no puede agendar a otro profesional ni a pacientes que no tiene asignados', async () => {
      await http()
        .post('/api/v1/turnos')
        .set(como('prof@a.com'))
        .send(turno({ profesionalId: ids.p2, fecha: '2026-11-19' }))
        .expect(403);
      const res = await http()
        .post('/api/v1/turnos')
        .set(como('prof@a.com'))
        .send(turno({ pacienteId: ids.ana, fecha: '2026-11-19' }))
        .expect(403);
      expect(res.body.message).toBe('El paciente no está asignado a vos');
    });

    it('no puede tocar turnos de otro profesional ni pasar los suyos a otro', async () => {
      const ajeno = await prisma.turno.findFirstOrThrow({
        where: { profesionalId: ids.p2, estadoAsistencia: 'pendiente' },
      });
      await http()
        .patch(`/api/v1/turnos/${ajeno.id}`)
        .set(como('prof@a.com'))
        .send({ hora: '12:00' })
        .expect(404);
      await http()
        .patch(`/api/v1/turnos/${ids.t1}`)
        .set(como('prof@a.com'))
        .send({ profesionalId: ids.p2 })
        .expect(403);
    });

    it('los cambios de admin o recepción no generan avisos', async () => {
      const antes = (await avisosDe('admin@a.com')).items.length;
      await http()
        .patch(`/api/v1/turnos/${ids.t1}`)
        .set(como('recep@a.com'))
        .send({ duracionMin: 40 })
        .expect(200);
      expect((await avisosDe('admin@a.com')).items.length).toBe(antes);
    });
  });

  describe('avisos', () => {
    it('se marcan leídos uno por uno o todos, por persona', async () => {
      const { items, noLeidos } = await avisosDe('admin@a.com');
      expect(noLeidos).toBe(3);
      await http()
        .post(`/api/v1/avisos/${items[0].id}/leido`)
        .set(como('admin@a.com'))
        .expect(204);
      expect((await avisosDe('admin@a.com')).noLeidos).toBe(2);

      const todos = await http()
        .post('/api/v1/avisos/leer-todos')
        .set(como('admin@a.com'))
        .expect(200);
      expect(todos.body.marcados).toBe(2);
      expect((await avisosDe('admin@a.com')).noLeidos).toBe(0);
      // Recepción conserva los suyos sin leer.
      expect((await avisosDe('recep@a.com')).noLeidos).toBe(3);
    });

    it('nadie puede marcar avisos de otra persona', async () => {
      const { items } = await avisosDe('recep@a.com');
      await http()
        .post(`/api/v1/avisos/${items[0].id}/leido`)
        .set(como('admin@a.com'))
        .expect(404);
    });
  });

  describe('turnos semanales', () => {
    it('crea los libres e informa las fechas que chocan', async () => {
      // Ocupa el lunes 30/11 a las 16:00 en Sala 1.
      await http()
        .post('/api/v1/turnos')
        .set(como('admin@a.com'))
        .send(
          turno({
            fecha: '2026-11-30',
            hora: '16:00',
            profesionalId: ids.p2,
            pacienteId: ids.ana,
          }),
        )
        .expect(201);

      const res = await http()
        .post('/api/v1/recurrencias')
        .set(como('prof@a.com'))
        .send({
          pacienteId: ids.juan,
          profesionalId: ids.p1,
          salaId: ids.s1,
          diaSemana: 1,
          hora: '16:00',
          duracionMin: 45,
          fechaDesde: LUNES,
          fechaHasta: '2026-12-07',
        })
        .expect(201);
      ids.rec = res.body.recurrenciaId;
      expect(res.body.creados.map((t: { fecha: string }) => t.fecha)).toEqual([
        '2026-11-16',
        '2026-11-23',
        '2026-12-07',
      ]);
      expect(res.body.conflictos).toEqual([
        {
          fecha: '2026-11-30',
          motivo: 'La sala Sala 1 está ocupada de 16:00 a 16:45',
        },
      ]);
      const { items } = await avisosDe('admin@a.com');
      expect(items[0].mensaje).toContain(
        'agendó turnos semanales con Juan López: 3 turno(s)',
      );
    });

    it('al finalizar, cancela los turnos pendientes desde la fecha', async () => {
      const res = await http()
        .post(`/api/v1/recurrencias/${ids.rec}/finalizar`)
        .set(como('prof@a.com'))
        .send({ desde: '2026-11-23' })
        .expect(200);
      expect(res.body.cancelados).toBe(2);
      const quedan = await prisma.turno.count({
        where: { recurrenciaId: ids.rec, estadoAsistencia: 'pendiente' },
      });
      expect(quedan).toBe(1);
    });
  });

  describe('aislamiento', () => {
    it('otro centro no ve ni toca los turnos', async () => {
      await http()
        .get(`/api/v1/turnos/${ids.t1}`)
        .set(como('admin@b.com'))
        .expect(404);
      const lista = await http()
        .get(`/api/v1/turnos?desde=${LUNES}&hasta=2026-11-22`)
        .set(como('admin@b.com'))
        .expect(200);
      expect(lista.body).toEqual([]);
      await http()
        .post('/api/v1/turnos')
        .set(como('admin@b.com'))
        .send(turno({ fecha: '2026-11-20' }))
        .expect(400);
    });
  });
});

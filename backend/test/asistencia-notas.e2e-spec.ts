import 'dotenv/config';
import { TODOS_LOS_MODULOS } from './ayudas.js';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { adaptadorPg } from '../src/prisma/adaptador.js';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../src/auth/password.js';
import {
  EstadoLiquidacion,
  PrismaClient,
  Rol,
} from '../src/generated/prisma/client.js';

const url = process.env.TEST_DATABASE_URL;
const CLAVE = 'clave-de-prueba-123';
// Un turno ya pasado (para marcar presente) y otro futuro, en meses distintos.
const PASADO = '2026-10-20';
const FUTURO = '2027-03-10';

describe.skipIf(!url)('Asistencia y notas cifradas (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaClient;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const http = () => request(app.getHttpServer());
  const como = (quien: string) => ({
    Authorization: `Bearer ${tokens[quien]}`,
  });
  const marcar = (quien: string, turnoId: string, estado: string) =>
    http()
      .post(`/api/v1/turnos/${turnoId}/asistencia`)
      .set(como(quien))
      .send({ estado });

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
      data: { nombre: 'Centro A', slug: 'a', planId: plan.id },
    });
    ids.centroA = a.id;
    const b = await prisma.centro.create({
      data: { nombre: 'Centro B', slug: 'b', planId: plan.id },
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
    const u1 = await usuario('prof1@a.com', a.id, Rol.profesional);
    const u2 = await usuario('prof2@a.com', a.id, Rol.profesional);
    const u3 = await usuario('prof3@a.com', a.id, Rol.profesional);
    await usuario('admin@b.com', b.id, Rol.admin);

    const prof = async (nombre: string, usuarioId: string) =>
      (
        await prisma.profesional.create({
          data: {
            centroId: a.id,
            nombre,
            apellido: 'Test',
            disciplina: 'Psico',
            usuarioId,
          },
        })
      ).id;
    ids.p1 = await prof('Pablo', u1);
    ids.p2 = await prof('Laura', u2);
    ids.p3 = await prof('Sofía', u3);

    const obraSocial = await prisma.financiador.create({
      data: { centroId: a.id, nombre: 'OSEP', tipo: 'obra_social' },
    });
    ids.juan = (
      await prisma.paciente.create({
        data: {
          centroId: a.id,
          nombre: 'Juan',
          apellido: 'López',
          dni: '30111222',
          financiadorId: obraSocial.id,
          nroAfiliado: 'AF-99',
        },
      })
    ).id;
    // Juan es paciente compartido de Pablo y Laura (no de Sofía).
    for (const profesionalId of [ids.p1, ids.p2]) {
      await prisma.pacienteProfesional.create({
        data: { centroId: a.id, pacienteId: ids.juan, profesionalId },
      });
    }

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
      'prof1@a.com',
      'prof2@a.com',
      'prof3@a.com',
      'admin@b.com',
    ]) {
      const res = await http()
        .post('/api/v1/auth/login')
        .send({ email: quien, password: CLAVE });
      tokens[quien] = res.body.accessToken;
    }

    const turno = async (profesionalId: string, fecha: string, hora: string) =>
      (
        await http()
          .post('/api/v1/turnos')
          .set(como('admin@a.com'))
          .send({
            pacienteId: ids.juan,
            profesionalId,
            fecha,
            hora,
            duracionMin: 45,
          })
          .expect(201)
      ).body.id as string;
    ids.tPasado = await turno(ids.p1, PASADO, '10:00');
    ids.tPasado2 = await turno(ids.p1, '2026-10-27', '10:00');
    ids.tLaura = await turno(ids.p2, PASADO, '11:00');
    ids.tFuturo = await turno(ids.p1, FUTURO, '10:00');
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('guarda el instante exacto aunque la base use otra zona horaria', async () => {
    // Con la sesión de la base en otra zona, el adaptador corría las fechas.
    const [fila] = await prisma.$queryRawUnsafe<{ local: string }[]>(
      `SELECT to_char(inicio AT TIME ZONE 'America/Argentina/Catamarca', 'YYYY-MM-DD HH24:MI') AS local
         FROM turnos WHERE id = $1::uuid`,
      ids.tFuturo,
    );
    expect(fila.local).toBe(`${FUTURO} 10:00`);
  });

  describe('marcar asistencia', () => {
    it('recepción marca presente un turno pasado', async () => {
      const res = await marcar('recep@a.com', ids.tPasado, 'presente').expect(
        200,
      );
      expect(res.body.estado).toBe('presente');
    });

    it('un turno futuro solo admite "ausente con aviso"', async () => {
      await marcar('admin@a.com', ids.tFuturo, 'presente').expect(400);
      await marcar('admin@a.com', ids.tFuturo, 'ausente_sin_aviso').expect(400);
      await marcar('admin@a.com', ids.tFuturo, 'ausente_con_aviso').expect(200);
    });

    it('el profesional marca los suyos pero no los de otro', async () => {
      await marcar('prof1@a.com', ids.tPasado2, 'ausente_sin_aviso').expect(
        200,
      );
      await marcar('prof1@a.com', ids.tLaura, 'presente').expect(404);
    });

    it('rechaza estados que no se marcan a mano', async () => {
      await marcar('admin@a.com', ids.tPasado, 'cancelado_profesional').expect(
        400,
      );
    });

    it('un turno marcado no se mueve ni se cancela hasta volverlo a pendiente', async () => {
      await http()
        .patch(`/api/v1/turnos/${ids.tPasado}`)
        .set(como('admin@a.com'))
        .send({ hora: '12:00' })
        .expect(400);
      await marcar('admin@a.com', ids.tPasado, 'pendiente').expect(200);
      await marcar('admin@a.com', ids.tPasado, 'presente').expect(200);
    });

    it('registra cada cambio con quién y cuándo', async () => {
      const res = await http()
        .get(`/api/v1/turnos/${ids.tPasado}/asistencia/cambios`)
        .set(como('admin@a.com'))
        .expect(200);
      expect(
        res.body.map((c: { estadoNuevo: string }) => c.estadoNuevo),
      ).toEqual(['presente', 'pendiente', 'presente']);
      expect(res.body[2].usuario.nombre).toBe('recep@a.com');
    });

    it('con la liquidación del mes cerrada, la asistencia queda fija', async () => {
      await prisma.liquidacion.create({
        data: {
          centroId: ids.centroA,
          profesionalId: ids.p1,
          periodo: new Date('2026-10-01T00:00:00Z'),
          totalBruto: 0,
          totalLiquidado: 0,
          estado: EstadoLiquidacion.cerrada,
        },
      });
      await marcar('admin@a.com', ids.tPasado, 'ausente_con_aviso').expect(409);
      // El de Laura, mismo mes, sigue abierto.
      await marcar('admin@a.com', ids.tLaura, 'presente').expect(200);
    });

    it('otro centro no ve el turno', async () => {
      await marcar('admin@b.com', ids.tLaura, 'presente').expect(404);
    });
  });

  describe('historial y planilla', () => {
    it('resume la asistencia del paciente', async () => {
      const res = await http()
        .get(`/api/v1/pacientes/${ids.juan}/asistencia`)
        .query({ desde: '2026-10-01', hasta: '2027-03-31' })
        .set(como('admin@a.com'))
        .expect(200);
      expect(res.body.resumen).toMatchObject({
        presente: 2,
        ausente_sin_aviso: 1,
        ausente_con_aviso: 1,
        pendiente: 0,
        porcentajeAsistencia: 50,
      });
      expect(res.body.turnos).toHaveLength(4);
    });

    it('el profesional ve solo sus turnos del paciente', async () => {
      const res = await http()
        .get(`/api/v1/pacientes/${ids.juan}/asistencia`)
        .query({ desde: '2026-10-01', hasta: '2027-03-31' })
        .set(como('prof2@a.com'))
        .expect(200);
      expect(res.body.turnos).toHaveLength(1);
      await http()
        .get(`/api/v1/pacientes/${ids.juan}/asistencia`)
        .set(como('prof3@a.com'))
        .expect(404);
    });

    it('arma la planilla mensual con los datos del financiador', async () => {
      const res = await http()
        .get(`/api/v1/pacientes/${ids.juan}/planilla`)
        .query({ mes: '2026-10' })
        .set(como('recep@a.com'))
        .expect(200);
      expect(res.body).toMatchObject({
        mes: '2026-10',
        centro: 'Centro A',
        paciente: {
          dni: '30111222',
          nroAfiliado: 'AF-99',
          financiador: { nombre: 'OSEP' },
        },
      });
      expect(res.body.filas.map((f: { fecha: string }) => f.fecha)).toEqual([
        PASADO,
        PASADO,
        '2026-10-27',
      ]);
      expect(res.body.profesionales).toHaveLength(2);
    });

    it('valida el mes', async () => {
      await http()
        .get(`/api/v1/pacientes/${ids.juan}/planilla`)
        .query({ mes: '2026-13' })
        .set(como('admin@a.com'))
        .expect(400);
    });
  });

  describe('notas de sesión', () => {
    it('el profesional escribe una nota privada y se guarda cifrada', async () => {
      const res = await http()
        .post(`/api/v1/pacientes/${ids.juan}/notas`)
        .set(como('prof1@a.com'))
        .send({
          texto: 'Privada: dificultad con la lectura',
          turnoId: ids.tPasado,
        })
        .expect(201);
      ids.notaPrivada = res.body.id;
      expect(res.body).toMatchObject({
        texto: 'Privada: dificultad con la lectura',
        compartida: false,
        propia: true,
      });
      const fila = await prisma.notaSesion.findUniqueOrThrow({
        where: { id: ids.notaPrivada },
      });
      expect(fila.texto.startsWith('v1:')).toBe(true);
      expect(fila.texto).not.toContain('lectura');
      const centro = await prisma.centro.findUniqueOrThrow({
        where: { id: ids.centroA },
      });
      expect(centro.claveDatos?.startsWith('v1:')).toBe(true);
    });

    it('comparte otra nota con el equipo', async () => {
      const res = await http()
        .post(`/api/v1/pacientes/${ids.juan}/notas`)
        .set(como('prof1@a.com'))
        .send({ texto: 'Para el equipo: viene con ánimo', compartida: true })
        .expect(201);
      ids.notaCompartida = res.body.id;
    });

    it('otro profesional del paciente ve solo la compartida', async () => {
      const res = await http()
        .get(`/api/v1/pacientes/${ids.juan}/notas`)
        .set(como('prof2@a.com'))
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        texto: 'Para el equipo: viene con ánimo',
        propia: false,
      });
    });

    it('el autor ve las dos, descifradas', async () => {
      const res = await http()
        .get(`/api/v1/pacientes/${ids.juan}/notas`)
        .set(como('prof1@a.com'))
        .expect(200);
      expect(res.body.map((n: { texto: string }) => n.texto)).toEqual([
        'Para el equipo: viene con ánimo',
        'Privada: dificultad con la lectura',
      ]);
    });

    it('un profesional que no atiende al paciente no accede', async () => {
      await http()
        .get(`/api/v1/pacientes/${ids.juan}/notas`)
        .set(como('prof3@a.com'))
        .expect(404);
    });

    it('admin y recepción no acceden a notas clínicas', async () => {
      for (const quien of ['admin@a.com', 'recep@a.com']) {
        await http()
          .get(`/api/v1/pacientes/${ids.juan}/notas`)
          .set(como(quien))
          .expect(403);
      }
    });

    it('solo el autor edita; una nota privada ajena "no existe"', async () => {
      await http()
        .patch(`/api/v1/notas/${ids.notaCompartida}`)
        .set(como('prof2@a.com'))
        .send({ texto: 'cambio' })
        .expect(403);
      await http()
        .patch(`/api/v1/notas/${ids.notaPrivada}`)
        .set(como('prof2@a.com'))
        .send({ texto: 'cambio' })
        .expect(404);
      const res = await http()
        .patch(`/api/v1/notas/${ids.notaPrivada}`)
        .set(como('prof1@a.com'))
        .send({ texto: 'Privada (editada)', compartida: true })
        .expect(200);
      expect(res.body).toMatchObject({
        texto: 'Privada (editada)',
        compartida: true,
      });
    });

    it('no acepta un turno de otro profesional', async () => {
      await http()
        .post(`/api/v1/pacientes/${ids.juan}/notas`)
        .set(como('prof1@a.com'))
        .send({ texto: 'x', turnoId: ids.tLaura })
        .expect(400);
    });

    it('un texto cifrado movido a otro paciente no se puede leer', async () => {
      const ana = await prisma.paciente.create({
        data: { centroId: ids.centroA, nombre: 'Ana', apellido: 'Ruiz' },
      });
      await prisma.pacienteProfesional.create({
        data: {
          centroId: ids.centroA,
          pacienteId: ana.id,
          profesionalId: ids.p1,
        },
      });
      const original = await prisma.notaSesion.findUniqueOrThrow({
        where: { id: ids.notaCompartida },
      });
      await prisma.notaSesion.create({
        data: {
          centroId: ids.centroA,
          pacienteId: ana.id,
          profesionalId: ids.p1,
          texto: original.texto,
        },
      });
      const res = await http()
        .get(`/api/v1/pacientes/${ana.id}/notas`)
        .set(como('prof1@a.com'))
        .expect(200);
      expect(res.body[0].texto).toMatch(/No se pudo descifrar/);
    });
  });

  describe('expediente', () => {
    const ruta = (sufijo = '') =>
      `/api/v1/pacientes/${ids.juan}/notas${sufijo}`;

    it('guarda si la evolución fue dictada y la fecha de edición del texto', async () => {
      const res = await http()
        .post(ruta())
        .set(como('prof1@a.com'))
        .send({ texto: 'Dictada y revisada', origen: 'dictada' })
        .expect(201);
      expect(res.body).toMatchObject({ origen: 'dictada', editadaEn: null });
      // Cambiar quién la ve no cuenta como edición.
      const visibilidad = await http()
        .patch(`/api/v1/notas/${res.body.id}`)
        .set(como('prof1@a.com'))
        .send({ compartida: true })
        .expect(200);
      expect(visibilidad.body.editadaEn).toBeNull();
      const texto = await http()
        .patch(`/api/v1/notas/${res.body.id}`)
        .set(como('prof1@a.com'))
        .send({ texto: 'Dictada, revisada y corregida' })
        .expect(200);
      expect(texto.body.editadaEn).toEqual(expect.any(String));
      const escrita = await http()
        .post(ruta())
        .set(como('prof1@a.com'))
        .send({ texto: 'Escrita con el teclado' })
        .expect(201);
      expect(escrita.body.origen).toBe('escrita');
    });

    it('rechaza un origen desconocido', async () => {
      await http()
        .post(ruta())
        .set(como('prof1@a.com'))
        .send({ texto: 'x', origen: 'grabada' })
        .expect(400);
    });

    it('ofrece mis sesiones recientes con el paciente, con la de hoy primero', async () => {
      const { zonaHoraria } = await prisma.centro.findUniqueOrThrow({
        where: { id: ids.centroA },
        select: { zonaHoraria: true },
      });
      const hoy = new Intl.DateTimeFormat('en-CA', {
        timeZone: zonaHoraria,
      }).format(new Date());
      const deHoy = (
        await http()
          .post('/api/v1/turnos')
          .set(como('admin@a.com'))
          .send({
            pacienteId: ids.juan,
            profesionalId: ids.p1,
            fecha: hoy,
            hora: '09:00',
            duracionMin: 45,
          })
          .expect(201)
      ).body.id as string;
      const res = await http()
        .get(ruta('/sesiones'))
        .set(como('prof1@a.com'))
        .expect(200);
      expect(res.body.hoy).toBe(hoy);
      expect(res.body.turnos[0]).toMatchObject({
        id: deHoy,
        fecha: hoy,
        hora: '09:00',
        conNota: false,
      });
      const turnos = res.body.turnos.map((t: { id: string }) => t.id);
      expect(turnos).not.toContain(ids.tLaura); // de otra profesional
      expect(turnos).not.toContain(ids.tFuturo); // todavía no llegó
      await http().get(ruta('/sesiones')).set(como('prof3@a.com')).expect(404);
      await http().get(ruta('/sesiones')).set(como('recep@a.com')).expect(403);
    });

    it('el borrador es solo de su autor, va cifrado y se borra al guardar la evolución', async () => {
      const vacio = await http()
        .get(ruta('/borrador'))
        .set(como('prof1@a.com'))
        .expect(200);
      expect(vacio.body).toEqual({ borrador: null });
      const guardado = await http()
        .put(ruta('/borrador'))
        .set(como('prof1@a.com'))
        .send({
          texto: 'Motivo\nBorrador a medio escribir',
          origen: 'dictada',
          turnoId: ids.tPasado,
        })
        .expect(200);
      expect(guardado.body.borrador).toMatchObject({
        texto: 'Motivo\nBorrador a medio escribir',
        origen: 'dictada',
        compartida: false,
        turnoId: ids.tPasado,
      });
      const fila = await prisma.borradorNota.findFirstOrThrow({
        where: { pacienteId: ids.juan, profesionalId: ids.p1 },
      });
      expect(fila.texto.startsWith('v1:')).toBe(true);
      expect(fila.texto).not.toContain('medio');

      // Guardar de nuevo lo reemplaza: hay uno solo por profesional y paciente.
      await http()
        .put(ruta('/borrador'))
        .set(como('prof1@a.com'))
        .send({ texto: 'Borrador corregido' })
        .expect(200);
      expect(
        await prisma.borradorNota.count({ where: { pacienteId: ids.juan } }),
      ).toBe(1);
      const ajeno = await http()
        .get(ruta('/borrador'))
        .set(como('prof2@a.com'))
        .expect(200);
      expect(ajeno.body).toEqual({ borrador: null });
      const mio = await http()
        .get(ruta('/borrador'))
        .set(como('prof1@a.com'))
        .expect(200);
      expect(mio.body.borrador.texto).toBe('Borrador corregido');

      await http()
        .post(ruta())
        .set(como('prof1@a.com'))
        .send({ texto: 'Borrador corregido' })
        .expect(201);
      expect(
        await prisma.borradorNota.count({
          where: { pacienteId: ids.juan, profesionalId: ids.p1 },
        }),
      ).toBe(0);
    });

    it('descartar borra el borrador; recepción, quien no atiende y otro centro no acceden', async () => {
      await http()
        .put(ruta('/borrador'))
        .set(como('prof2@a.com'))
        .send({ texto: 'Borrador de Laura' })
        .expect(200);
      await http()
        .delete(ruta('/borrador'))
        .set(como('prof2@a.com'))
        .expect(204);
      expect(
        await prisma.borradorNota.count({ where: { pacienteId: ids.juan } }),
      ).toBe(0);
      await http()
        .put(ruta('/borrador'))
        .set(como('recep@a.com'))
        .send({ texto: 'x' })
        .expect(403);
      await http()
        .put(ruta('/borrador'))
        .set(como('prof3@a.com'))
        .send({ texto: 'x' })
        .expect(404);
      await http().get(ruta('/borrador')).set(como('admin@b.com')).expect(403);
    });

    it('no acepta en el borrador un turno de otro profesional', async () => {
      await http()
        .put(ruta('/borrador'))
        .set(como('prof1@a.com'))
        .send({ texto: 'x', turnoId: ids.tLaura })
        .expect(400);
    });

    it('un borrador que nadie tocó en 30 días se borra al leerlo y con la limpieza', async () => {
      const envejecer = (profesionalId: string, dias: number) =>
        prisma.$executeRaw`UPDATE borradores_nota SET actualizado_en = now() - make_interval(days => ${dias}) WHERE paciente_id = ${ids.juan}::uuid AND profesional_id = ${profesionalId}::uuid`;

      await http()
        .put(ruta('/borrador'))
        .set(como('prof1@a.com'))
        .send({ texto: 'Viejo' })
        .expect(200);
      await envejecer(ids.p1, 31);
      const leido = await http()
        .get(ruta('/borrador'))
        .set(como('prof1@a.com'))
        .expect(200);
      expect(leido.body).toEqual({ borrador: null });
      expect(
        await prisma.borradorNota.count({ where: { pacienteId: ids.juan } }),
      ).toBe(0);

      // La limpieza general borra solo los vencidos.
      await http()
        .put(ruta('/borrador'))
        .set(como('prof1@a.com'))
        .send({ texto: 'Reciente' })
        .expect(200);
      await http()
        .put(ruta('/borrador'))
        .set(como('prof2@a.com'))
        .send({ texto: 'De hace mucho' })
        .expect(200);
      await envejecer(ids.p2, 40);
      const { BorradoresVencidos } =
        await import('../src/notas/borradores-vencidos.js');
      expect(await app.get(BorradoresVencidos).limpiar()).toBe(1);
      const quedan = await prisma.borradorNota.findMany({
        where: { pacienteId: ids.juan },
      });
      expect(quedan.map((b) => b.profesionalId)).toEqual([ids.p1]);
      await http()
        .delete(ruta('/borrador'))
        .set(como('prof1@a.com'))
        .expect(204);
    });

    it('borrar un turno deja el borrador sin turno, sin impedirlo', async () => {
      const turno = (
        await http()
          .post('/api/v1/turnos')
          .set(como('admin@a.com'))
          .send({
            pacienteId: ids.juan,
            profesionalId: ids.p1,
            fecha: '2026-10-30',
            hora: '15:00',
            duracionMin: 45,
          })
          .expect(201)
      ).body.id as string;
      await http()
        .put(ruta('/borrador'))
        .set(como('prof1@a.com'))
        .send({ texto: 'Con turno', turnoId: turno })
        .expect(200);
      await prisma.turno.delete({ where: { id: turno } });
      const fila = await prisma.borradorNota.findFirstOrThrow({
        where: { pacienteId: ids.juan, profesionalId: ids.p1 },
      });
      expect(fila).toMatchObject({ turnoId: null, centroId: ids.centroA });
      await http()
        .delete(ruta('/borrador'))
        .set(como('prof1@a.com'))
        .expect(204);
    });
  });
});

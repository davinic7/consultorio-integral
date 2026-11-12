import 'dotenv/config';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { hashPassword } from '../src/auth/password.js';
import { Modulo, PrismaClient, Rol } from '../src/generated/prisma/client.js';
import { adaptadorPg } from '../src/prisma/adaptador.js';

const url = process.env.TEST_DATABASE_URL;
const CLAVE = 'clave-de-prueba-123';
const M = Modulo;

/**
 * Planes v2: límites (profesionales, salas, personas), módulos nuevos (notas,
 * salas, ARCA por profesional) y el pase de los centros de los planes 1.0.
 */
describe.skipIf(!url)('Planes: límites y módulos nuevos (e2e)', () => {
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
  const profesional = (quien: string, nombre: string) =>
    http()
      .post('/api/v1/profesionales')
      .set(como(quien))
      .send({ nombre, apellido: 'Prueba', disciplina: 'Psicología' });

  async function centroCon(
    slug: string,
    planId: string,
    email: string,
  ): Promise<string> {
    const centro = await prisma.centro.create({
      data: { nombre: slug, slug, planId },
    });
    const usuario = await prisma.usuario.create({
      data: {
        email,
        nombre: 'Admin',
        passwordHash: await hashPassword(CLAVE),
      },
    });
    await prisma.miembro.create({
      data: { centroId: centro.id, usuarioId: usuario.id, rol: Rol.admin },
    });
    return centro.id;
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    process.env.LOGIN_LIMITE_POR_MIN = '1000';
    prisma = new PrismaClient({ adapter: adaptadorPg(url!) });
    await prisma.$executeRawUnsafe(
      'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
    );

    // Individual: 1 profesional, sin salas, 2 personas; sin ARCA por profesional.
    ids.individual = (
      await prisma.plan.create({
        data: {
          codigo: 'ind',
          nombre: 'Individual',
          precioMensual: 0,
          maxProfesionales: 1,
          maxSalas: 0,
          maxUsuarios: 2,
          modulos: {
            create: [M.agenda, M.pacientes, M.facturacion_arca].map(
              (modulo) => ({ modulo }),
            ),
          },
        },
      })
    ).id;
    ids.centroPlan = (
      await prisma.plan.create({
        data: {
          codigo: 'cen',
          nombre: 'Centro',
          precioMensual: 0,
          modulos: {
            create: Object.values(Modulo).map((modulo) => ({ modulo })),
          },
        },
      })
    ).id;
    ids.solo = await centroCon('solo', ids.individual, 'solo@x.com');
    ids.grande = await centroCon('grande', ids.centroPlan, 'grande@x.com');
    await prisma.usuario.create({
      data: {
        email: 'sa@x.com',
        nombre: 'SA',
        esSuperadmin: true,
        passwordHash: await hashPassword(CLAVE),
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
    for (const quien of ['solo@x.com', 'grande@x.com', 'sa@x.com']) {
      tokens[quien] = (await login(quien)).body.accessToken;
    }
  });

  afterAll(async () => {
    await app?.close();
    await prisma?.$disconnect();
  });

  it('un plan individual permite un solo profesional activo, también al reactivar', async () => {
    const p1 = await profesional('solo@x.com', 'Uno').expect(201);
    const res = await profesional('solo@x.com', 'Dos').expect(403);
    expect(res.body.message).toBe(
      'El plan Individual permite hasta 1 profesional activo',
    );

    // Dando de baja al primero hay lugar; reactivarlo con otro activo, no.
    await http()
      .patch(`/api/v1/profesionales/${p1.body.id}`)
      .set(como('solo@x.com'))
      .send({ activo: false })
      .expect(200);
    await profesional('solo@x.com', 'Dos').expect(201);
    await http()
      .patch(`/api/v1/profesionales/${p1.body.id}`)
      .set(como('solo@x.com'))
      .send({ activo: true })
      .expect(403);
    // Editar a uno inactivo sin reactivarlo sí se puede.
    await http()
      .patch(`/api/v1/profesionales/${p1.body.id}`)
      .set(como('solo@x.com'))
      .send({ disciplina: 'Fonoaudiología' })
      .expect(200);
  });

  it('sin el módulo salas no se crean salas; la lista se puede leer', async () => {
    const res = await http()
      .post('/api/v1/salas')
      .set(como('solo@x.com'))
      .send({ nombre: 'Consultorio' })
      .expect(403);
    expect(res.body.message).toBe('El plan del centro no incluye Salas');
    await http().get('/api/v1/salas').set(como('solo@x.com')).expect(200);
  });

  it('el límite de salas cuenta solo las activas', async () => {
    await prisma.plan.update({
      where: { id: ids.centroPlan },
      data: { maxSalas: 1 },
    });
    const s1 = await http()
      .post('/api/v1/salas')
      .set(como('grande@x.com'))
      .send({ nombre: 'Sala 1' })
      .expect(201);
    const res = await http()
      .post('/api/v1/salas')
      .set(como('grande@x.com'))
      .send({ nombre: 'Sala 2' })
      .expect(403);
    expect(res.body.message).toBe('El plan Centro permite hasta 1 sala activa');
    await http()
      .patch(`/api/v1/salas/${s1.body.id}`)
      .set(como('grande@x.com'))
      .send({ activa: false })
      .expect(200);
    await http()
      .post('/api/v1/salas')
      .set(como('grande@x.com'))
      .send({ nombre: 'Sala 2' })
      .expect(201);
    await http()
      .patch(`/api/v1/salas/${s1.body.id}`)
      .set(como('grande@x.com'))
      .send({ activa: true })
      .expect(403);
    await prisma.plan.update({
      where: { id: ids.centroPlan },
      data: { maxSalas: null },
    });
  });

  it('el límite de personas cuenta a todos los miembros activos', async () => {
    const alta = (email: string) =>
      http()
        .post('/api/v1/usuarios')
        .set(como('solo@x.com'))
        .send({ email, nombre: 'Persona', rol: 'recepcion', password: CLAVE });
    const sec = await alta('secretaria@x.com').expect(201);
    const res = await alta('otra@x.com').expect(403);
    expect(res.body.message).toBe(
      'El plan Individual permite hasta 2 personas con acceso',
    );
    await http()
      .patch(`/api/v1/usuarios/${sec.body.id}`)
      .set(como('solo@x.com'))
      .send({ activo: false })
      .expect(200);
    await alta('otra@x.com').expect(201);
    await http()
      .patch(`/api/v1/usuarios/${sec.body.id}`)
      .set(como('solo@x.com'))
      .send({ activo: true })
      .expect(403);
  });

  it('sin el módulo notas, las notas de sesión responden 403', async () => {
    const paciente = await http()
      .post('/api/v1/pacientes')
      .set(como('solo@x.com'))
      .send({ nombre: 'Ana', apellido: 'Paz' })
      .expect(201);
    const res = await http()
      .get(`/api/v1/pacientes/${paciente.body.id}/notas`)
      .set(como('solo@x.com'))
      .expect(403);
    expect(res.body.message).toBe(
      'El plan del centro no incluye Notas de sesión',
    );
  });

  it('sin ARCA por profesional, el centro factura y no puede cambiarlo', async () => {
    const res = await http()
      .put('/api/v1/facturacion/config')
      .set(como('solo@x.com'))
      .send({ facturaCadaProfesional: true })
      .expect(403);
    expect(res.body.message).toBe(
      'Tu plan no incluye la facturación de cada profesional con su CUIT',
    );
    // En un plan que lo incluye, sí; y si después se quita el módulo, factura el centro.
    const ok = await http()
      .put('/api/v1/facturacion/config')
      .set(como('grande@x.com'))
      .send({ facturaCadaProfesional: true })
      .expect(200);
    expect(ok.body.facturaCadaProfesional).toBe(true);
    await http()
      .patch(`/api/v1/planes/${ids.centroPlan}`)
      .set(como('sa@x.com'))
      .send({
        modulos: Object.values(Modulo).filter(
          (m) => m !== M.arca_por_profesional,
        ),
      })
      .expect(200);
    const config = await http()
      .get('/api/v1/facturacion/config')
      .set(como('grande@x.com'))
      .expect(200);
    expect(config.body.facturaCadaProfesional).toBe(false);
  });

  it('el superadmin edita los límites; null es sin límite', async () => {
    const res = await http()
      .patch(`/api/v1/planes/${ids.individual}`)
      .set(como('sa@x.com'))
      .send({ maxProfesionales: 3, maxUsuarios: null })
      .expect(200);
    expect(res.body).toMatchObject({
      maxProfesionales: 3,
      maxSalas: 0,
      maxUsuarios: null,
    });
    await profesional('solo@x.com', 'Tres').expect(201);
    const nuevo = await http()
      .post('/api/v1/planes')
      .set(como('sa@x.com'))
      .send({
        codigo: 'nuevo',
        nombre: 'Nuevo',
        precioMensual: 0,
        modulos: [M.agenda],
        maxSalas: 4,
      })
      .expect(201);
    expect(nuevo.body).toMatchObject({
      maxProfesionales: null,
      maxSalas: 4,
      maxUsuarios: null,
    });
    await http()
      .patch(`/api/v1/planes/${ids.individual}`)
      .set(como('sa@x.com'))
      .send({ maxProfesionales: -1 })
      .expect(400);
  });

  it('el seed crea los planes nuevos y pasa los centros de los planes 1.0 sin perder datos', async () => {
    // Planes de la versión 1.0, con un centro grande y un consultorio unipersonal.
    const viejo = await prisma.plan.create({
      data: {
        codigo: 'integral',
        nombre: 'Integral',
        precioMensual: 0,
        modulos: { create: [{ modulo: M.agenda }] },
      },
    });
    const grande = await centroCon('viejo-grande', viejo.id, 'vg@x.com');
    await prisma.miembro.create({
      data: {
        centroId: grande,
        usuarioId: (await prisma.usuario.findUniqueOrThrow({
          where: { email: 'sa@x.com' },
        }))!.id,
        rol: Rol.recepcion,
      },
    });
    const solo = await centroCon('viejo-solo', viejo.id, 'vs@x.com');
    const adminSolo = await prisma.usuario.findUniqueOrThrow({
      where: { email: 'vs@x.com' },
    });
    await prisma.profesional.create({
      data: {
        centroId: solo,
        usuarioId: adminSolo.id,
        nombre: 'Vera',
        apellido: 'Sola',
        disciplina: 'Psicología',
      },
    });
    const pacientesAntes = await prisma.paciente.count();

    const seed = () =>
      execFileSync(process.execPath, ['--import', 'tsx', 'prisma/seed.ts'], {
        env: { ...process.env, DATABASE_URL: url },
        stdio: 'pipe',
      });
    seed();
    seed(); // Idempotente.

    const planes = await prisma.plan.findMany({
      where: { codigo: { contains: '-' } },
      select: {
        codigo: true,
        maxProfesionales: true,
        modulos: { select: { modulo: true } },
      },
      orderBy: { codigo: 'asc' },
    });
    expect(planes.map((p) => p.codigo)).toEqual([
      'centro-basico',
      'centro-full',
      'centro-intermedio',
      'individual-basico',
      'individual-full',
      'individual-intermedio',
    ]);
    const de = (codigo: string) =>
      planes.find((p) => p.codigo === codigo)!.modulos.map((m) => m.modulo);
    expect(de('individual-basico')).not.toContain(M.facturacion_arca);
    expect(de('individual-intermedio')).toContain(M.facturacion_arca);
    expect(de('individual-full')).toEqual(
      expect.arrayContaining([M.obras_sociales, M.dictado, M.reportes]),
    );
    expect(de('centro-basico')).toEqual(
      expect.arrayContaining([M.salas, M.asistencia]),
    );
    expect(de('centro-basico')).not.toContain(M.cobros);
    expect(de('centro-intermedio')).toContain(M.liquidacion);
    expect(de('centro-full')).toContain(M.arca_por_profesional);
    expect(
      planes.find((p) => p.codigo === 'individual-basico')!.maxProfesionales,
    ).toBe(1);

    const planDe = async (id: string) =>
      (
        await prisma.centro.findUniqueOrThrow({
          where: { id },
          select: { plan: { select: { codigo: true } } },
        })
      ).plan.codigo;
    expect(await planDe(grande)).toBe('centro-full');
    expect(await planDe(solo)).toBe('individual-full');
    expect(
      (await prisma.plan.findUniqueOrThrow({ where: { id: viejo.id } })).activo,
    ).toBe(false);
    // Los centros de otros planes no se tocan, ni los datos de los centros.
    expect(await planDe(ids.solo)).toBe('ind');
    expect(await prisma.paciente.count()).toBe(pacientesAntes);
    expect(await prisma.profesional.count({ where: { centroId: solo } })).toBe(
      1,
    );
  });
});

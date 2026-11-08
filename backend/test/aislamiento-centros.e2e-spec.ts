import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import {
  clienteDeCentro,
  ErrorAislamientoCentro,
} from '../src/prisma/centro.js';

const url = process.env.TEST_DATABASE_URL;

/** Datos de un centro de prueba, creados con su cliente limitado. */
async function sembrarCentro(
  prisma: PrismaClient,
  planId: string,
  slug: string,
) {
  const centro = await prisma.centro.create({
    data: { nombre: slug, slug, planId },
  });
  const db = clienteDeCentro(prisma, centro.id);
  const sala = await db.sala.create({ data: { nombre: 'Sala 1' } as any });
  const profesional = await db.profesional.create({
    data: { nombre: 'Ana', apellido: slug, disciplina: 'Psicología' } as any,
  });
  const paciente = await db.paciente.create({
    data: { nombre: 'Juan', apellido: slug, dni: '30111222' } as any,
  });
  return { centro, db, sala, profesional, paciente };
}

describe.skipIf(!url)('Aislamiento entre centros (PostgreSQL)', () => {
  let prisma: PrismaClient;
  let a: Awaited<ReturnType<typeof sembrarCentro>>;
  let b: Awaited<ReturnType<typeof sembrarCentro>>;

  beforeAll(async () => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: url! }),
    });
    await prisma.$executeRawUnsafe(
      'TRUNCATE centros, planes, usuarios RESTART IDENTITY CASCADE',
    );
    const plan = await prisma.plan.create({
      data: { codigo: 'test', nombre: 'Test', precioMensual: 0 },
    });
    a = await sembrarCentro(prisma, plan.id, 'centro-a');
    b = await sembrarCentro(prisma, plan.id, 'centro-b');
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('cada centro ve solo sus pacientes (aunque compartan DNI)', async () => {
    const deA = await a.db.paciente.findMany();
    expect(deA.map((p) => p.id)).toEqual([a.paciente.id]);
    expect(await b.db.paciente.count()).toBe(1);
  });

  it('no encuentra por id un registro de otro centro', async () => {
    expect(
      await a.db.paciente.findUnique({ where: { id: b.paciente.id } }),
    ).toBeNull();
  });

  it('no puede modificar ni borrar registros de otro centro', async () => {
    await expect(
      a.db.paciente.update({
        where: { id: b.paciente.id },
        data: { nombre: 'X' },
      }),
    ).rejects.toMatchObject({ code: 'P2025' });
    const { count } = await a.db.sala.deleteMany({ where: { id: b.sala.id } });
    expect(count).toBe(0);
    expect(await b.db.sala.count()).toBe(1);
  });

  it('rechaza pedir datos de otro centro de forma explícita', async () => {
    await expect(
      a.db.paciente.findMany({ where: { centroId: b.centro.id } }),
    ).rejects.toBeInstanceOf(ErrorAislamientoCentro);
  });

  it('la base rechaza un turno que mezcla datos de dos centros', async () => {
    const inicio = new Date('2026-11-10T13:00:00Z');
    await expect(
      a.db.turno.create({
        data: {
          pacienteId: b.paciente.id, // paciente de otro centro
          profesionalId: a.profesional.id,
          salaId: a.sala.id,
          inicio,
          fin: new Date(inicio.getTime() + 45 * 60_000),
        } as any,
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('crea un turno válido y lo devuelve con sus relaciones', async () => {
    const inicio = new Date('2026-11-10T13:00:00Z');
    const turno = await a.db.turno.create({
      data: {
        pacienteId: a.paciente.id,
        profesionalId: a.profesional.id,
        salaId: a.sala.id,
        inicio,
        fin: new Date(inicio.getTime() + 45 * 60_000),
      } as any,
      include: { paciente: true, sala: true },
    });
    expect(turno.centroId).toBe(a.centro.id);
    expect(turno.paciente.id).toBe(a.paciente.id);
    expect(await b.db.turno.count()).toBe(0);
  });

  it('la base rechaza un turno que termina antes de empezar', async () => {
    const inicio = new Date('2026-11-11T13:00:00Z');
    await expect(
      a.db.turno.create({
        data: {
          pacienteId: a.paciente.id,
          profesionalId: a.profesional.id,
          inicio,
          fin: inicio,
        } as any,
      }),
    ).rejects.toThrow(/turnos_fin_despues_de_inicio/);
  });
});

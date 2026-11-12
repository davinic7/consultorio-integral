/**
 * Datos base: planes y sus módulos. Idempotente: se puede correr varias veces
 * (corre en cada arranque del servidor).
 *
 * Los planes se crean solo si no existen: después los administra el superadmin
 * desde la pantalla de planes (módulos, límites y precio), sin tocar código.
 *
 * También pasa una única vez los centros de los planes de la versión 1.0
 * (basico, profesional, integral) a los planes nuevos, y deja esos planes inactivos.
 * Uso: npx prisma db seed
 */
import 'dotenv/config';
import { adaptadorPg } from '../src/prisma/adaptador.js';
import { Modulo, PrismaClient, Rol } from '../src/generated/prisma/client.js';

const M = Modulo;

const INDIVIDUAL_BASICO: Modulo[] = [
  M.agenda,
  M.asistencia,
  M.pacientes,
  M.notas,
  M.cobros,
];
const INDIVIDUAL_INTERMEDIO: Modulo[] = [
  ...INDIVIDUAL_BASICO,
  M.facturacion_arca,
];
const INDIVIDUAL_FULL: Modulo[] = [
  ...INDIVIDUAL_INTERMEDIO,
  M.obras_sociales,
  M.dictado,
  M.reportes,
];

const CENTRO_BASICO: Modulo[] = [
  M.agenda,
  M.asistencia,
  M.pacientes,
  M.notas,
  M.salas,
];
const CENTRO_INTERMEDIO: Modulo[] = [...CENTRO_BASICO, M.cobros, M.liquidacion];
const CENTRO_FULL: Modulo[] = [
  ...CENTRO_INTERMEDIO,
  M.obras_sociales,
  M.facturacion_arca,
  M.arca_por_profesional,
  M.reportes,
];

/** Individual: un profesional y, si quiere, una persona más (secretaría). */
const LIMITES_INDIVIDUAL = { maxProfesionales: 1, maxSalas: 0, maxUsuarios: 2 };
const SIN_LIMITES = {
  maxProfesionales: null,
  maxSalas: null,
  maxUsuarios: null,
};

// Precios a definir: quedan en 0 hasta fijar la política comercial.
const PLANES = [
  {
    codigo: 'individual-basico',
    nombre: 'Individual Básico',
    modulos: INDIVIDUAL_BASICO,
    ...LIMITES_INDIVIDUAL,
  },
  {
    codigo: 'individual-intermedio',
    nombre: 'Individual Intermedio',
    modulos: INDIVIDUAL_INTERMEDIO,
    ...LIMITES_INDIVIDUAL,
  },
  {
    codigo: 'individual-full',
    nombre: 'Individual Full',
    modulos: INDIVIDUAL_FULL,
    ...LIMITES_INDIVIDUAL,
  },
  {
    codigo: 'centro-basico',
    nombre: 'Centro Básico',
    modulos: CENTRO_BASICO,
    ...SIN_LIMITES,
  },
  {
    codigo: 'centro-intermedio',
    nombre: 'Centro Intermedio',
    modulos: CENTRO_INTERMEDIO,
    ...SIN_LIMITES,
  },
  {
    codigo: 'centro-full',
    nombre: 'Centro Full',
    modulos: CENTRO_FULL,
    ...SIN_LIMITES,
  },
];

/** Plan de la 1.0 → [plan para un centro, plan para un profesional que trabaja solo]. */
const PASE_DE_PLANES: Record<string, [string, string]> = {
  basico: ['centro-basico', 'individual-intermedio'],
  profesional: ['centro-intermedio', 'individual-intermedio'],
  integral: ['centro-full', 'individual-full'],
};

const prisma = new PrismaClient({
  adapter: adaptadorPg(process.env.DATABASE_URL!),
});

async function crearPlanes() {
  for (const { modulos, ...datos } of PLANES) {
    const existe = await prisma.plan.findUnique({
      where: { codigo: datos.codigo },
    });
    if (existe) continue;
    await prisma.plan.create({
      data: {
        ...datos,
        precioMensual: 0,
        modulos: { create: modulos.map((modulo) => ({ modulo })) },
      },
    });
    console.log(`Plan ${datos.nombre}: ${modulos.join(', ')}`);
  }
}

/**
 * Un centro es "de un profesional que trabaja solo" si tiene una sola persona
 * activa y esa persona tiene su ficha de profesional.
 */
async function esIndividual(centroId: string): Promise<boolean> {
  const miembros = await prisma.miembro.findMany({
    where: { centroId, activo: true },
    select: { usuarioId: true, rol: true },
  });
  if (miembros.length !== 1 || miembros[0].rol !== Rol.admin) return false;
  const fichas = await prisma.profesional.count({
    where: { centroId, activo: true, usuarioId: miembros[0].usuarioId },
  });
  return fichas === 1;
}

async function pasarCentrosDePlanesViejos() {
  for (const [viejo, [paraCentro, paraIndividual]] of Object.entries(
    PASE_DE_PLANES,
  )) {
    const plan = await prisma.plan.findUnique({
      where: { codigo: viejo },
      select: { id: true, activo: true },
    });
    if (!plan) continue;
    const destinos = await prisma.plan.findMany({
      where: { codigo: { in: [paraCentro, paraIndividual] } },
      select: { id: true, codigo: true },
    });
    const id = (codigo: string) =>
      destinos.find((d) => d.codigo === codigo)!.id;
    const centros = await prisma.centro.findMany({
      where: { planId: plan.id },
      select: { id: true },
    });
    for (const c of centros) {
      const destino = (await esIndividual(c.id)) ? paraIndividual : paraCentro;
      await prisma.centro.update({
        where: { id: c.id },
        data: { planId: id(destino) },
      });
      console.log(`Centro ${c.id}: plan ${viejo} → ${destino}`);
    }
    if (plan.activo) {
      await prisma.plan.update({
        where: { id: plan.id },
        data: { activo: false },
      });
      console.log(
        `Plan ${viejo}: inactivo (reemplazado por los planes nuevos)`,
      );
    }
  }
}

try {
  await crearPlanes();
  await pasarCentrosDePlanesViejos();
} finally {
  await prisma.$disconnect();
}

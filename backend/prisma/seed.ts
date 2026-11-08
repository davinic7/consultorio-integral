/**
 * Datos base: planes y sus módulos. Idempotente: se puede correr varias veces.
 * Uso: npx prisma db seed
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Modulo, PrismaClient } from '../src/generated/prisma/client.js';

const BASICO: Modulo[] = [Modulo.agenda, Modulo.asistencia, Modulo.pacientes];
const PROFESIONAL: Modulo[] = [
  ...BASICO,
  Modulo.cobros,
  Modulo.liquidacion,
  Modulo.reportes,
];
const INTEGRAL: Modulo[] = [
  ...PROFESIONAL,
  Modulo.obras_sociales,
  Modulo.facturacion_arca,
];

// Precios a definir: quedan en 0 hasta fijar la política comercial.
const PLANES = [
  { codigo: 'basico', nombre: 'Básico', precioMensual: 0, modulos: BASICO },
  {
    codigo: 'profesional',
    nombre: 'Profesional',
    precioMensual: 0,
    modulos: PROFESIONAL,
  },
  {
    codigo: 'integral',
    nombre: 'Integral',
    precioMensual: 0,
    modulos: INTEGRAL,
  },
];

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  for (const { modulos, precioMensual, ...datos } of PLANES) {
    const plan = await prisma.plan.upsert({
      where: { codigo: datos.codigo },
      update: { nombre: datos.nombre },
      create: { ...datos, precioMensual },
    });
    await prisma.$transaction([
      prisma.planModulo.deleteMany({ where: { planId: plan.id } }),
      prisma.planModulo.createMany({
        data: modulos.map((modulo) => ({ planId: plan.id, modulo })),
      }),
    ]);
    console.log(`Plan ${plan.nombre}: ${modulos.join(', ')}`);
  }
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}

/**
 * Datos de demostración para desarrollo: dos centros y un usuario por rol.
 * Idempotente. Uso: npm run db:demo   (requiere DEMO_PASSWORD en .env)
 *
 * Usuarios (todos con la contraseña DEMO_PASSWORD):
 *   superadmin@demo.local   superadministrador de la plataforma
 *   admin@demo.local        admin de Centro Demo
 *   recepcion@demo.local    recepción de Centro Demo
 *   profesional@demo.local  profesional en Centro Demo y recepción en Centro Demo Norte
 */
import 'dotenv/config';
import { adaptadorPg } from '../src/prisma/adaptador.js';
import { hashPassword } from '../src/auth/password.js';
import {
  PrismaClient,
  Rol,
  TipoFinanciador,
} from '../src/generated/prisma/client.js';

// En un servidor (NODE_ENV=production) solo se cargan si se pide explícitamente
// con CARGAR_DEMO=true, por ejemplo en un ambiente de demostración.
if (
  process.env.NODE_ENV === 'production' &&
  process.env.CARGAR_DEMO !== 'true'
) {
  throw new Error(
    'Los datos demo no se cargan en producción (salvo CARGAR_DEMO=true)',
  );
}
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 10) {
  throw new Error('Definí DEMO_PASSWORD (al menos 10 caracteres) en .env');
}

const prisma = new PrismaClient({
  adapter: adaptadorPg(process.env.DATABASE_URL!),
});

async function usuario(email: string, nombre: string, esSuperadmin = false) {
  const passwordHash = await hashPassword(password!);
  return prisma.usuario.upsert({
    where: { email },
    update: { passwordHash, activo: true, esSuperadmin },
    create: { email, nombre, passwordHash, esSuperadmin },
  });
}

async function centro(slug: string, nombre: string, planCodigo: string) {
  const plan = await prisma.plan.findUniqueOrThrow({
    where: { codigo: planCodigo },
  });
  return prisma.centro.upsert({
    where: { slug },
    update: {},
    create: { slug, nombre, planId: plan.id },
  });
}

async function miembro(centroId: string, usuarioId: string, rol: Rol) {
  await prisma.miembro.upsert({
    where: { centroId_usuarioId: { centroId, usuarioId } },
    update: { rol, activo: true },
    create: { centroId, usuarioId, rol },
  });
}

/** Obras sociales de ejemplo; no pisa cambios hechos desde la app. */
async function financiador(
  centroId: string,
  nombre: string,
  tipo: TipoFinanciador,
  reglas: {
    codigoPrestacion?: string;
    requiereOrden?: boolean;
    requiereToken?: boolean;
    maxSesionesSemana?: number;
    diasValidezOrden?: number;
  } = {},
) {
  return prisma.financiador.upsert({
    where: { centroId_nombre: { centroId, nombre } },
    update: {},
    create: { centroId, nombre, tipo, ...reglas },
  });
}

/** Valor de la sesión desde 2026-01-01, si esa cobertura todavía no tiene precio. */
async function precio(
  centroId: string,
  financiadorId: string | null,
  monto: number,
) {
  const hay = await prisma.precio.count({
    where: { centroId, financiadorId, pacienteId: null },
  });
  if (hay) return;
  await prisma.precio.create({
    data: {
      centroId,
      financiadorId,
      monto,
      vigenteDesde: new Date('2026-01-01T00:00:00Z'),
    },
  });
}

try {
  const demo = await centro('demo', 'Centro Demo', 'centro-full');
  const norte = await centro('demo-norte', 'Centro Demo Norte', 'centro-basico');

  await usuario('superadmin@demo.local', 'Superadmin Demo', true);
  const admin = await usuario('admin@demo.local', 'Ana Admin');
  const recepcion = await usuario('recepcion@demo.local', 'Rita Recepción');
  const profesional = await usuario(
    'profesional@demo.local',
    'Pablo Profesional',
  );

  await miembro(demo.id, admin.id, Rol.admin);
  await miembro(demo.id, recepcion.id, Rol.recepcion);
  await miembro(demo.id, profesional.id, Rol.profesional);
  await miembro(norte.id, profesional.id, Rol.recepcion);

  const osep = await financiador(demo.id, 'OSEP', TipoFinanciador.obra_social, {
    codigoPrestacion: '250101',
    requiereOrden: true,
    maxSesionesSemana: 3,
    diasValidezOrden: 30,
  });
  const prepaga = await financiador(
    demo.id,
    'Prepaga Salud',
    TipoFinanciador.prepaga,
    { requiereToken: true },
  );
  const cud = await financiador(demo.id, 'CUD', TipoFinanciador.cud, {
    requiereOrden: true,
  });

  // Valor de la sesión: particular y por cobertura.
  await precio(demo.id, null, 12000);
  await precio(demo.id, osep.id, 9500);
  await precio(demo.id, prepaga.id, 11000);
  await precio(demo.id, cud.id, 10500);

  console.log(
    'Datos demo listos: Centro Demo y Centro Demo Norte (ver usuarios en prisma/demo.ts).',
  );
} finally {
  await prisma.$disconnect();
}

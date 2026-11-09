/**
 * Crea (o promueve) el superadministrador de la plataforma.
 *
 *   npm run crear-superadmin -- email@dominio.com "Nombre Apellido"
 *
 * Contraseña: se toma de SUPERADMIN_PASSWORD si está definida; si no, se genera
 * una al azar y se muestra una sola vez. Si el email ya existe, solo se lo marca
 * como superadmin (no se cambia su contraseña).
 */
import 'dotenv/config';
import { adaptadorPg } from '../src/prisma/adaptador.js';
import { randomBytes } from 'node:crypto';
import { hashPassword } from '../src/auth/password.js';
import { PrismaClient } from '../src/generated/prisma/client.js';

const [emailArg, ...nombrePartes] = process.argv.slice(2);
const email = emailArg?.trim().toLowerCase();
const nombre = nombrePartes.join(' ').trim();
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !nombre) {
  console.error(
    'Uso: npm run crear-superadmin -- email@dominio.com "Nombre Apellido"',
  );
  process.exit(1);
}

const prisma = new PrismaClient({
  adapter: adaptadorPg(process.env.DATABASE_URL!),
});

try {
  const existente = await prisma.usuario.findUnique({ where: { email } });
  if (existente) {
    await prisma.usuario.update({
      where: { email },
      data: { esSuperadmin: true, activo: true },
    });
    console.log(
      `${email} ya existía: ahora es superadmin (contraseña sin cambios).`,
    );
  } else {
    const dada = process.env.SUPERADMIN_PASSWORD;
    if (dada !== undefined && dada.length < 10) {
      throw new Error('SUPERADMIN_PASSWORD debe tener al menos 10 caracteres');
    }
    const password = dada ?? randomBytes(15).toString('base64url');
    await prisma.usuario.create({
      data: {
        email,
        nombre,
        esSuperadmin: true,
        passwordHash: await hashPassword(password),
      },
    });
    console.log(`Superadmin creado: ${email}`);
    if (!dada) console.log(`Contraseña (se muestra una sola vez): ${password}`);
  }
} finally {
  await prisma.$disconnect();
}

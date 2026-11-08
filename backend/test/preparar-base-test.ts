import 'dotenv/config';
import { execSync } from 'node:child_process';

/** Lleva la base de tests al último schema. Sin TEST_DATABASE_URL no hace nada. */
export default function prepararBaseTest(): void {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;
  if (url === process.env.DATABASE_URL) {
    throw new Error(
      'TEST_DATABASE_URL no puede ser la misma base que DATABASE_URL',
    );
  }
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

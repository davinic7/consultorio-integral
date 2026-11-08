import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Aplica las migraciones en la base de tests (TEST_DATABASE_URL) antes de correr.
    globalSetup: ['./test/preparar-base-test.ts'],
    // Los tests de integración comparten la base de tests: uno por vez.
    fileParallelism: false,
  },
});

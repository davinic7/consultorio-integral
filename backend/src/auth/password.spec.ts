import { hashPassword, hashSenuelo, verificarPassword } from './password.js';

describe('password', () => {
  it('verifica la contraseña correcta y rechaza otra', async () => {
    const hash = await hashPassword('una-clave-larga');
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verificarPassword('una-clave-larga', hash)).toBe(true);
    expect(await verificarPassword('otra-clave-larga', hash)).toBe(false);
  });

  it('genera un salt distinto en cada hash', async () => {
    expect(await hashPassword('igual-igual')).not.toBe(
      await hashPassword('igual-igual'),
    );
  });

  it('normaliza Unicode (misma clave escrita con acento compuesto o separado)', async () => {
    const hash = await hashPassword('contraseña-segura');
    expect(await verificarPassword('contraseña-segura', hash)).toBe(true);
  });

  it('rechaza hashes con formato desconocido', async () => {
    expect(await verificarPassword('x', '$2y$10$hashdebcrypt')).toBe(false);
  });

  it('el señuelo es un hash válido', async () => {
    expect(await hashSenuelo()).toMatch(/^scrypt\$/);
  });
});

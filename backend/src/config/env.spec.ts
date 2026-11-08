import { validateEnv } from './env.js';

const BASE = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_SECRET: 'x'.repeat(32),
};

describe('validateEnv', () => {
  it('aplica valores por defecto', () => {
    const env = validateEnv(BASE);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toBe('http://localhost:4200');
    expect(env.ACCESS_TOKEN_TTL_SEG).toBe(900);
    expect(env.REFRESH_TOKEN_TTL_DIAS).toBe(30);
  });

  it('falla si falta DATABASE_URL', () => {
    expect(() => validateEnv({ JWT_SECRET: BASE.JWT_SECRET })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('exige un JWT_SECRET de al menos 32 caracteres', () => {
    expect(() => validateEnv({ ...BASE, JWT_SECRET: 'corta' })).toThrow(
      /JWT_SECRET/,
    );
  });
});

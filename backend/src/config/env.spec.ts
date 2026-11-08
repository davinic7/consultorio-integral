import { validateEnv } from './env.js';

describe('validateEnv', () => {
  it('aplica valores por defecto', () => {
    const env = validateEnv({
      DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    });
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toBe('http://localhost:4200');
  });

  it('falla si falta DATABASE_URL', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });
});

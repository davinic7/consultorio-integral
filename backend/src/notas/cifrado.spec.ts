import { randomBytes } from 'node:crypto';
import { cifrarAes, claveMaestra, descifrarAes } from './cifrado.js';

describe('cifrado AES-256-GCM', () => {
  const clave = randomBytes(32);

  it('cifra y descifra', () => {
    const dato = cifrarAes(Buffer.from('Sesión: avanzó mucho'), clave, 'ctx');
    expect(dato.startsWith('v1:')).toBe(true);
    expect(dato).not.toContain('avanzó');
    expect(descifrarAes(dato, clave, 'ctx')?.toString()).toBe(
      'Sesión: avanzó mucho',
    );
  });

  it('cada cifrado es distinto aunque el texto sea igual', () => {
    const a = cifrarAes(Buffer.from('igual'), clave, 'ctx');
    const b = cifrarAes(Buffer.from('igual'), clave, 'ctx');
    expect(a).not.toBe(b);
  });

  it('no descifra con otro contexto (nota movida a otra fila)', () => {
    const dato = cifrarAes(Buffer.from('privado'), clave, 'paciente-1');
    expect(descifrarAes(dato, clave, 'paciente-2')).toBeNull();
  });

  it('no descifra con otra clave ni si el dato fue alterado', () => {
    const dato = cifrarAes(Buffer.from('privado'), clave, 'ctx');
    expect(descifrarAes(dato, randomBytes(32), 'ctx')).toBeNull();
    const b = Buffer.from(dato.slice(3), 'base64');
    b[b.length - 1] ^= 1;
    expect(descifrarAes(`v1:${b.toString('base64')}`, clave, 'ctx')).toBeNull();
    expect(descifrarAes('texto sin cifrar', clave, 'ctx')).toBeNull();
  });

  it('deriva siempre la misma clave maestra de 32 bytes', () => {
    const a = claveMaestra('una-clave-maestra-de-prueba-123456');
    expect(a.length).toBe(32);
    expect(a.equals(claveMaestra('una-clave-maestra-de-prueba-123456'))).toBe(
      true,
    );
    expect(a.equals(claveMaestra('otra-clave-maestra-de-prueba-12345'))).toBe(
      false,
    );
  });
});

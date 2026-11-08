import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  aplicarCentro,
  ErrorAislamientoCentro,
  MODELOS_DE_CENTRO,
} from './centro.js';

const C = '0190f000-0000-7000-8000-000000000001';
const OTRO = '0190f000-0000-7000-8000-000000000002';

describe('MODELOS_DE_CENTRO', () => {
  it('incluye exactamente los modelos del schema que tienen centroId', () => {
    const schema = readFileSync(
      join(import.meta.dirname, '../../prisma/schema.prisma'),
      'utf8',
    );
    const conCentro = [...schema.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)]
      .filter(([, , cuerpo]) => /^\s+centroId\s/m.test(cuerpo))
      .map(([, nombre]) => nombre)
      .sort();
    expect([...MODELOS_DE_CENTRO].sort()).toEqual(conCentro);
  });
});

describe('aplicarCentro', () => {
  it('agrega centroId al where de las lecturas', () => {
    expect(aplicarCentro('findMany', undefined, C)).toEqual({
      where: { centroId: C },
    });
    expect(aplicarCentro('findUnique', { where: { id: 'x' } }, C)).toEqual({
      where: { id: 'x', centroId: C },
    });
    expect(
      aplicarCentro('count', { where: { activo: true } }, C).where,
    ).toEqual({
      activo: true,
      centroId: C,
    });
  });

  it('completa centroId en las altas', () => {
    expect(aplicarCentro('create', { data: { nombre: 'Sala 1' } }, C)).toEqual({
      data: { nombre: 'Sala 1', centroId: C },
    });
    expect(
      aplicarCentro(
        'createMany',
        { data: [{ nombre: 'A' }, { nombre: 'B' }] },
        C,
      ).data,
    ).toEqual([
      { nombre: 'A', centroId: C },
      { nombre: 'B', centroId: C },
    ]);
  });

  it('filtra updates y deletes por centro', () => {
    expect(
      aplicarCentro('update', { where: { id: 'x' }, data: { nombre: 'N' } }, C),
    ).toEqual({
      where: { id: 'x', centroId: C },
      data: { nombre: 'N' },
    });
    expect(aplicarCentro('deleteMany', {}, C)).toEqual({
      where: { centroId: C },
    });
  });

  it('upsert: filtra el where y completa el create', () => {
    const r = aplicarCentro(
      'upsert',
      { where: { id: 'x' }, create: { nombre: 'A' }, update: {} },
      C,
    );
    expect(r.where).toEqual({ id: 'x', centroId: C });
    expect(r.create).toEqual({ nombre: 'A', centroId: C });
  });

  it('rechaza pedir, escribir o mover datos de otro centro', () => {
    expect(() =>
      aplicarCentro('findMany', { where: { centroId: OTRO } }, C),
    ).toThrow(ErrorAislamientoCentro);
    expect(() =>
      aplicarCentro('create', { data: { centroId: OTRO } }, C),
    ).toThrow(ErrorAislamientoCentro);
    expect(() =>
      aplicarCentro(
        'create',
        { data: { centro: { connect: { id: OTRO } } } },
        C,
      ),
    ).toThrow(ErrorAislamientoCentro);
    expect(() =>
      aplicarCentro(
        'update',
        { where: { id: 'x' }, data: { centroId: OTRO } },
        C,
      ),
    ).toThrow(ErrorAislamientoCentro);
  });

  it('acepta centroId explícito si es el mismo centro', () => {
    expect(aplicarCentro('findFirst', { where: { centroId: C } }, C)).toEqual({
      where: { centroId: C },
    });
  });
});

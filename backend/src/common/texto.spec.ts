import {
  normalizar,
  palabrasDeBusqueda,
  textoBusquedaPaciente,
} from './texto.js';

describe('texto', () => {
  it('normaliza tildes, diéresis, ñ y mayúsculas', () => {
    expect(normalizar('  Gómez MÜLLER Peña ')).toBe('gomez muller pena');
  });

  it('arma el texto de búsqueda con el teléfono también en dígitos', () => {
    expect(
      textoBusquedaPaciente({
        nombre: 'Juana',
        apellido: 'Gómez',
        dni: '30111222',
        telefono: '3834 555-123',
      }),
    ).toBe('juana gomez 30111222 3834 555-123 3834555123');
  });

  it('separa palabras y limpia puntos de los números', () => {
    expect(palabrasDeBusqueda(' Juana  30.111.222 ')).toEqual([
      'juana',
      '30111222',
    ]);
    expect(palabrasDeBusqueda(undefined)).toEqual([]);
  });
});

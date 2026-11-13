import { comoMandar } from './dictado.service';

describe('cola del dictado', () => {
  const p = { id: 'a', intentos: 0 };

  it('la grabación en pantalla que esperaba señal se manda a la vista', () => {
    expect(comoMandar(p, 'a', 'sin_conexion')).toBe('en_pantalla');
  });

  it('la que se está mandando, o muestra un error, la decide la persona', () => {
    expect(comoMandar(p, 'a', 'enviando')).toBe('saltear');
    expect(comoMandar(p, 'a', 'transcribiendo')).toBe('saltear');
    expect(comoMandar(p, 'a', 'error')).toBe('saltear');
  });

  it('si ya no está en pantalla, va en segundo plano', () => {
    expect(comoMandar(p, 'a', 'inactivo')).toBe('segundo_plano');
    expect(comoMandar(p, 'a', 'grabando')).toBe('segundo_plano');
    expect(comoMandar(p, null, 'sin_conexion')).toBe('segundo_plano');
    expect(comoMandar(p, 'b', 'enviando')).toBe('segundo_plano');
  });

  it('después de tres fallas del servidor deja de reintentar sola', () => {
    expect(comoMandar({ id: 'a', intentos: 3 }, null, 'inactivo')).toBe('saltear');
    expect(comoMandar({ id: 'a', intentos: 2 }, null, 'inactivo')).toBe('segundo_plano');
  });
});

import { edad, enlaceWhatsApp } from './contacto';

describe('enlaceWhatsApp', () => {
  it('arma el formato 54 9 + área + número', () => {
    expect(enlaceWhatsApp('3834 277003')).toBe('https://wa.me/5493834277003');
    expect(enlaceWhatsApp('+54 9 383 427-7003')).toBe('https://wa.me/5493834277003');
    expect(enlaceWhatsApp('+54 383 4277003')).toBe('https://wa.me/5493834277003');
    expect(enlaceWhatsApp('0383 15 4277003')).toBe('https://wa.me/5493834277003');
  });

  it('sin área asume 383', () => {
    expect(enlaceWhatsApp('4277003')).toBe('https://wa.me/5493834277003');
  });

  it('descarta lo que no es un número', () => {
    expect(enlaceWhatsApp('')).toBeNull();
    expect(enlaceWhatsApp(null)).toBeNull();
    expect(enlaceWhatsApp('123')).toBeNull();
  });
});

describe('edad', () => {
  it('cuenta los años cumplidos', () => {
    const hoy = new Date(2026, 10, 9); // 9/11/2026
    expect(edad('2018-11-09', hoy)).toBe(8);
    expect(edad('2018-11-10', hoy)).toBe(7);
    expect(edad(null, hoy)).toBeNull();
  });
});

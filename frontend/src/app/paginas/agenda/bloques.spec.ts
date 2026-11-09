import { horaEnPosicion, PX_POR_HORA, ubicarBloques } from './bloques';

describe('ubicarBloques', () => {
  it('ubica por horario', () => {
    const [b] = ubicarBloques([{ hora: '08:00', horaFin: '08:45' }]);
    expect(b.top).toBe(PX_POR_HORA); // 1 h después de las 07:00
    expect(b.alto).toBe(PX_POR_HORA * 0.75);
    expect(b).toMatchObject({ izquierda: 0, ancho: 100 });
  });

  it('pone lado a lado los superpuestos y deja entero al que no choca', () => {
    const b = ubicarBloques([
      { hora: '10:00', horaFin: '11:00' },
      { hora: '10:30', horaFin: '11:30' },
      { hora: '12:00', horaFin: '12:30' },
    ]);
    expect(b.map((x) => [x.izquierda, x.ancho])).toEqual([
      [0, 50],
      [50, 50],
      [0, 100],
    ]);
  });

  it('los contiguos no se consideran superpuestos', () => {
    const b = ubicarBloques([
      { hora: '10:00', horaFin: '10:45' },
      { hora: '10:45', horaFin: '11:30' },
    ]);
    expect(b.every((x) => x.ancho === 100)).toBe(true);
  });
});

describe('horaEnPosicion', () => {
  it('redondea a 15 minutos dentro del horario visible', () => {
    expect(horaEnPosicion(0)).toBe('07:00');
    expect(horaEnPosicion(PX_POR_HORA * 3 + 20)).toBe('10:15');
    expect(horaEnPosicion(-50)).toBe('07:00');
  });
});

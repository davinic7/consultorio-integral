import { horaAlSoltar } from '../paginas/agenda/bloques';
import { destinatario, enlaceRecordatorio, textoRecordatorio } from './recordatorio';

const TURNO = {
  fecha: '2026-11-17',
  hora: '10:00',
  paciente: { id: 'pa', nombre: 'Tomás', apellido: 'Gil' },
  profesional: { id: 'pr', nombre: 'Laura', apellido: 'Ríos', disciplina: 'Fonoaudiología' },
};
const PACIENTE = {
  nombre: 'Tomás',
  telefono: '3834 123456',
  responsableNombre: null,
  responsableTelefono: null,
};

describe('recordatorio de turno', () => {
  it('le escribe al paciente o, si no tiene teléfono, a su responsable', () => {
    expect(destinatario(PACIENTE)).toEqual({ nombre: 'Tomás', telefono: '3834 123456' });
    expect(
      destinatario({
        ...PACIENTE,
        telefono: null,
        responsableNombre: 'Marta',
        responsableTelefono: '383 4999888',
      }),
    ).toEqual({ nombre: 'Marta', telefono: '383 4999888' });
    expect(destinatario({ ...PACIENTE, telefono: '  ' })).toBeNull();
  });

  it('dice hoy, mañana o el día, con hora, profesional y centro', () => {
    expect(textoRecordatorio(TURNO, 'Tomás', 'Centro Norte', '2026-11-16')).toBe(
      'Hola Tomás, te recordamos el turno mañana a las 10:00 con Laura Ríos en Centro Norte. ' +
        'Si no pueden venir, avisanos con tiempo. ¡Gracias!',
    );
    expect(textoRecordatorio(TURNO, 'Tomás', 'C', '2026-11-17')).toContain('el turno hoy a las');
    expect(textoRecordatorio(TURNO, 'Tomás', 'C', '2026-11-10')).toMatch(
      /el turno el \S+ 17\/11 a las/,
    );
  });

  it('al responsable le aclara de quién es el turno', () => {
    expect(textoRecordatorio(TURNO, 'Marta', 'C', '2026-11-16')).toContain(
      'Hola Marta, te recordamos el turno de Tomás mañana',
    );
  });

  it('arma el enlace de WhatsApp con el texto; sin teléfono válido, null', () => {
    const enlace = enlaceRecordatorio(TURNO, PACIENTE, 'C', '2026-11-16')!;
    expect(enlace.startsWith('https://wa.me/5493834123456?text=')).toBe(true);
    expect(decodeURIComponent(enlace.split('text=')[1])).toContain('Hola Tomás');
    expect(
      enlaceRecordatorio(TURNO, { ...PACIENTE, telefono: '12' }, 'C', '2026-11-16'),
    ).toBeNull();
  });
});

describe('arrastrar un turno', () => {
  it('cae donde quedó el borde de arriba del turno, en pasos de 15 minutos', () => {
    // 60 px por hora desde las 07:00: el puntero a 190 px, agarrado 10 px abajo del borde.
    expect(horaAlSoltar(190, 10)).toBe('10:00');
    expect(horaAlSoltar(200, 0)).toBe('10:15');
    // No antes del comienzo ni después del final de la grilla.
    expect(horaAlSoltar(5, 30)).toBe('07:00');
    expect(horaAlSoltar(99_999, 0)).toBe('21:45');
  });
});

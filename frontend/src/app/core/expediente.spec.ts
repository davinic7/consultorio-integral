import type { Nota, SesionNota } from './api/modelos';
import {
  agruparPorMes,
  estaVacio,
  etiquetaMomento,
  etiquetaSesion,
  fechaYHora,
  filtrar,
  ordenar,
  plantillaGuia,
  resumen,
  secciones,
  sesionPorDefecto,
  sumarAlFinal,
  textoParaGuardar,
} from './expediente';

const ZONA = 'America/Argentina/Catamarca';

function nota(datos: Partial<Nota> & { id: string }): Nota {
  return {
    texto: 'Texto',
    compartida: false,
    origen: 'escrita',
    propia: true,
    profesional: { id: 'p1', nombre: 'Gabriela', apellido: 'Molina', disciplina: 'Fonoaudiología' },
    turno: null,
    creadaEn: '2026-11-09T14:52:00Z',
    actualizadaEn: '2026-11-09T14:52:00Z',
    editadaEn: null,
    ...datos,
  };
}

describe('expediente', () => {
  describe('guía de estructura', () => {
    it('arma la plantilla y la vuelve a leer por secciones', () => {
      const texto = plantillaGuia()
        .replace('Motivo\n', 'Motivo\nSeguimiento de fonemas vibrantes.\n')
        .replace('Plan\n', 'Plan\nSumar /r/ en sílaba media.\n');
      expect(secciones(texto)).toEqual([
        { titulo: 'Motivo', texto: 'Seguimiento de fonemas vibrantes.' },
        { titulo: 'Plan', texto: 'Sumar /r/ en sílaba media.' },
      ]);
    });

    it('reconoce los títulos con dos puntos y respeta el texto suelto', () => {
      expect(secciones('Llamada con la mamá.\n\nobservaciones:\nVino cansada.')).toEqual([
        { titulo: null, texto: 'Llamada con la mamá.' },
        { titulo: 'Observaciones', texto: 'Vino cansada.' },
      ]);
    });

    it('una evolución con solo los títulos está vacía', () => {
      expect(estaVacio(plantillaGuia())).toBe(true);
      expect(estaVacio('Motivo\nAlgo')).toBe(false);
    });

    it('resume en una línea y suma tramos al final', () => {
      expect(resumen('Motivo\nControl.\n\nPlan\nSeguir\nigual.')).toBe(
        'Motivo: Control. · Plan: Seguir igual.',
      );
      expect(sumarAlFinal('Motivo\nControl.\n\n', 'Otro tramo')).toBe(
        'Motivo\nControl.\n\nOtro tramo',
      );
      expect(sumarAlFinal('', 'Primero')).toBe('Primero');
      expect(sumarAlFinal('Igual', '  ')).toBe('Igual');
    });

    it('al guardar saca los títulos que quedaron vacíos', () => {
      const texto = plantillaGuia().replace('Observaciones\n', 'Observaciones\nVino cansada.\n');
      expect(textoParaGuardar(texto)).toBe('Observaciones\nVino cansada.');
      expect(textoParaGuardar('\n  Suelto  \n\n')).toBe('Suelto');
    });
  });

  describe('fechas en la zona del centro', () => {
    it('muestra el día, la fecha y la hora locales', () => {
      // 14:52 UTC son las 11:52 en Argentina.
      expect(etiquetaMomento('2026-11-09T14:52:00Z', ZONA)).toBe('lun 09/11 · 11:52');
      expect(fechaYHora('2026-11-09T14:52:00Z', ZONA, '2026-11-12')).toBe('09/11 a las 11:52');
      expect(fechaYHora('2025-12-30T14:52:00Z', ZONA, '2026-11-12')).toBe('30/12/2025 a las 11:52');
    });
  });

  describe('filtros y orden', () => {
    const propia = nota({ id: 'a', texto: 'Praxias linguales', creadaEn: '2026-11-11T14:00:00Z' });
    const ajena = nota({
      id: 'b',
      propia: false,
      texto: 'Lectura de sílabas',
      profesional: { id: 'p2', nombre: 'Rocío', apellido: 'Herrera', disciplina: 'Psicopedagogía' },
      creadaEn: '2026-11-06T18:30:00Z',
    });
    const vieja = nota({ id: 'c', texto: 'Llamada', creadaEn: '2026-09-08T21:05:00Z' });
    const todas = [propia, ajena, vieja];
    const hoy = '2026-11-12';

    it('filtra por autor', () => {
      const ids = (f: Parameters<typeof filtrar>[1]) =>
        filtrar(todas, f, hoy, ZONA).map((n) => n.id);
      expect(ids({ q: '', periodo: 'todo', autor: 'mias' })).toEqual(['a', 'c']);
      expect(ids({ q: '', periodo: 'todo', autor: 'equipo' })).toEqual(['b']);
    });

    it('filtra por período y busca sin importar tildes ni mayúsculas', () => {
      const ids = (f: Parameters<typeof filtrar>[1]) =>
        filtrar(todas, f, hoy, ZONA).map((n) => n.id);
      expect(ids({ q: '', periodo: 'd7', autor: 'todas' })).toEqual(['a', 'b']);
      expect(ids({ q: '', periodo: 'd30', autor: 'todas' })).toEqual(['a', 'b']);
      expect(ids({ q: 'SILABAS', periodo: 'todo', autor: 'todas' })).toEqual(['b']);
      expect(ids({ q: 'herrera', periodo: 'todo', autor: 'todas' })).toEqual(['b']);
    });

    it('ordena por la fecha de la sesión, no por cuándo se escribió', () => {
      const tarde = nota({
        id: 'd',
        creadaEn: '2026-11-12T13:00:00Z',
        turno: { id: 't', inicio: '2026-11-02T14:00:00Z', sala: 'Sala 2' },
      });
      expect(ordenar([vieja, tarde, propia]).map((n) => n.id)).toEqual(['a', 'd', 'c']);
    });

    it('agrupa por mes respetando el orden', () => {
      const grupos = agruparPorMes(ordenar(todas), ZONA);
      expect(grupos.map((g) => [g.mes, g.notas.map((n) => n.id)])).toEqual([
        ['noviembre 2026', ['a', 'b']],
        ['septiembre 2026', ['c']],
      ]);
    });
  });

  describe('sesiones', () => {
    const sesion = (datos: Partial<SesionNota> & { id: string; fecha: string }): SesionNota => ({
      hora: '11:00',
      inicio: `${datos.fecha}T14:00:00Z`,
      estadoAsistencia: 'pendiente',
      sala: { id: 's', nombre: 'Sala 2' },
      conNota: false,
      ...datos,
    });

    it('nombra la sesión de hoy y avisa si ya tiene evolución', () => {
      expect(etiquetaSesion(sesion({ id: 'h', fecha: '2026-11-12' }), '2026-11-12')).toBe(
        'Hoy 12/11 · 11:00 · Sala 2',
      );
      expect(
        etiquetaSesion(
          sesion({ id: 'l', fecha: '2026-11-09', conNota: true, sala: null }),
          '2026-11-12',
        ),
      ).toBe('lun 09/11 · 11:00 (ya tiene evolución)');
    });

    it('propone el turno de hoy que todavía no tiene evolución', () => {
      const hoy = '2026-11-12';
      expect(sesionPorDefecto([sesion({ id: 'h', fecha: hoy })], hoy)).toBe('h');
      expect(sesionPorDefecto([sesion({ id: 'h', fecha: hoy, conNota: true })], hoy)).toBeNull();
      expect(sesionPorDefecto([sesion({ id: 'v', fecha: '2026-11-09' })], hoy)).toBeNull();
    });
  });
});

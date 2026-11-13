import { TestBed } from '@angular/core/testing';
import { ReportesApi } from '../../core/api/api';
import type { Reporte } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { alturas, hojasDeReporte, mesCorto, Reportes } from './reportes';

const conteo = {
  turnos: 4,
  presentes: 3,
  ausentesConAviso: 0,
  ausentesSinAviso: 1,
  cancelados: 0,
  pendientes: 0,
  asistencia: 75,
};

const REPORTE: Reporte = {
  desde: '2026-10',
  hasta: '2026-11',
  soloProfesional: false,
  total: { ...conteo, facturado: 28000, cobrado: 10000, pacientes: 2, pacientesNuevos: 1 },
  meses: [
    { ...conteo, mes: '2026-10', pacientes: 2, facturado: 28000, cobrado: 10000 },
    {
      ...conteo,
      mes: '2026-11',
      turnos: 0,
      presentes: 0,
      asistencia: null,
      pacientes: 0,
      facturado: 0,
      cobrado: 0,
    },
  ],
  porProfesional: [
    {
      ...conteo,
      profesional: { id: 'p1', nombre: 'Laura', apellido: 'Díaz', disciplina: 'Psicología' },
      facturado: 28000,
      cobrado: 10000,
    },
  ],
  porCobertura: [{ financiador: null, sesiones: 3, facturado: 28000 }],
};

describe('Reportes', () => {
  it('mesCorto y alturas', () => {
    expect(mesCorto('2026-11')).toBe('nov 26');
    expect(alturas([0, 50, 100])).toEqual([0, 50, 100]);
    expect(alturas([1, 1000])).toEqual([2, 100]);
    expect(alturas([0, 0])).toEqual([0, 0]);
  });

  async function crear(r: Reporte) {
    const reporte = vi.fn().mockResolvedValue(r);
    await TestBed.configureTestingModule({
      imports: [Reportes],
      providers: [
        { provide: ReportesApi, useValue: { reporte } },
        {
          provide: AuthService,
          useValue: { sesion: () => ({ centro: { zonaHoraria: 'America/Argentina/Catamarca' } }) },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Reportes);
    await fixture.whenStable();
    fixture.detectChanges();
    return { el: fixture.nativeElement as HTMLElement, reporte, fixture };
  }

  it('pide los últimos 6 meses y muestra totales y tablas', async () => {
    const { el, reporte } = await crear(REPORTE);
    const [desde, hasta] = reporte.mock.calls[0]!;
    expect(hasta).toMatch(/^\d{4}-\d{2}$/);
    expect(desde < hasta).toBe(true);
    expect(el.textContent).toContain('Sesiones atendidas');
    expect(el.textContent).toContain('75%');
    expect(el.textContent).toContain('Díaz, Laura');
    expect(el.textContent).toContain('Particular');
    expect(el.textContent).toContain('1 nuevos');
  });

  it('hojasDeReporte lleva las tablas de la pantalla', () => {
    const hojas = hojasDeReporte(REPORTE);
    expect(hojas.map((h) => h.nombre)).toEqual([
      'Resumen',
      'Por mes',
      'Por profesional',
      'Por cobertura',
    ]);
    const [resumen, porMes, porProf, porCob] = hojas;
    expect(resumen!.filas[0]).toEqual(['Período', 'Octubre 2026 a Noviembre 2026']);
    expect(resumen!.filas).toContainEqual(['Asistencia', { valor: 0.75, formato: 'porcentaje' }]);
    expect(resumen!.filas).toContainEqual(['Falta cobrar', { valor: 18000, formato: 'plata' }]);
    expect(resumen!.filas.at(-1)).toEqual(['Pacientes nuevos', 1]);
    expect(porMes!.filas[0]).toEqual([
      'Octubre 2026',
      4,
      3,
      0,
      1,
      { valor: 0.75, formato: 'porcentaje' },
      2,
      28000,
      10000,
    ]);
    // Un mes sin turnos no tiene porcentaje.
    expect(porMes!.filas[1]![5]).toEqual({ valor: null, formato: 'porcentaje' });
    expect(porMes!.total![0]).toBe('Total');
    expect(porMes!.total!.slice(-2)).toEqual([28000, 10000]);
    expect(porProf!.filas[0]!.slice(0, 2)).toEqual(['Díaz, Laura', 'Psicología']);
    expect(porCob!.filas[0]).toEqual(['Particular', 3, 28000]);
  });

  it('el Excel de un profesional no lleva la hoja por profesional ni los nuevos', () => {
    const hojas = hojasDeReporte({
      ...REPORTE,
      soloProfesional: true,
      total: { ...REPORTE.total, pacientesNuevos: null },
    });
    expect(hojas.map((h) => h.nombre)).toEqual(['Resumen', 'Por mes', 'Por cobertura']);
    expect(hojas[0]!.filas.at(-1)![0]).toBe('Pacientes atendidos');
  });

  it('Descargar Excel baja el reporte del rango que se ve', async () => {
    const original = URL.createObjectURL;
    URL.createObjectURL = vi.fn().mockReturnValue('blob:prueba');
    let bajado = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      bajado = this.download;
    });
    try {
      const { el } = await crear(REPORTE);
      const boton = [...el.querySelectorAll('button')].find((b) =>
        b.textContent.includes('Descargar Excel'),
      )!;
      expect(boton.disabled).toBe(false);
      boton.click();
      expect(bajado).toBe('reporte-2026-10-a-2026-11.xlsx');
    } finally {
      click.mockRestore();
      URL.createObjectURL = original;
    }
  });

  it('para un profesional no muestra la tabla por profesional', async () => {
    const { el } = await crear({
      ...REPORTE,
      soloProfesional: true,
      total: { ...REPORTE.total, pacientesNuevos: null },
    });
    expect(el.textContent).toContain('Tus números');
    expect(el.textContent).not.toContain('Por profesional');
    expect(el.textContent).not.toContain('nuevos');
  });
});

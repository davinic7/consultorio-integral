import { TestBed } from '@angular/core/testing';
import { ReportesApi } from '../../core/api/api';
import type { Reporte } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { alturas, mesCorto, Reportes } from './reportes';

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

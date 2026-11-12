import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { AsistenciaApi } from '../../core/api/api';
import type { Planilla as DatosPlanilla } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { Planilla } from './planilla';

const PROF = { id: 'pr1', nombre: 'Laura', apellido: 'Ríos', disciplina: 'Fonoaudiología' };
const OTRO = { id: 'pr2', nombre: 'Pablo', apellido: 'Paz', disciplina: 'Psicología' };

function planilla(extra: Partial<DatosPlanilla> = {}): DatosPlanilla {
  return {
    mes: '2026-10',
    centro: 'Centro Norte',
    paciente: {
      id: 'pa1',
      nombre: 'Tomás',
      apellido: 'Gil',
      dni: '45111222',
      financiador: { id: 'f1', nombre: 'OSEP', tipo: 'obra_social' },
      nroAfiliado: '123/4',
      tieneCud: true,
    },
    profesionales: [PROF],
    filas: [
      {
        turnoId: 't1',
        fecha: '2026-10-05',
        hora: '10:00',
        horaFin: '10:45',
        profesional: PROF,
        estado: 'presente',
      },
      {
        turnoId: 't2',
        fecha: '2026-10-12',
        hora: '10:00',
        horaFin: '10:45',
        profesional: PROF,
        estado: 'pendiente',
      },
    ],
    ...extra,
  };
}

describe('Planilla de asistencia', () => {
  const api = { planilla: vi.fn() };

  beforeEach(async () => {
    api.planilla.mockReset();
    api.planilla.mockResolvedValue(planilla());
    await TestBed.configureTestingModule({
      imports: [Planilla],
      providers: [
        provideRouter([]),
        { provide: AsistenciaApi, useValue: api },
        {
          provide: AuthService,
          useValue: { sesion: () => ({ centro: { zonaHoraria: 'America/Argentina/Catamarca' } }) },
        },
      ],
    }).compileComponents();
  });

  async function crear(mes = '2026-10', profesionalId?: string) {
    const fixture = TestBed.createComponent(Planilla);
    fixture.componentRef.setInput('id', 'pa1');
    fixture.componentRef.setInput('mes', mes);
    if (profesionalId) fixture.componentRef.setInput('profesionalId', profesionalId);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('pide la planilla del paciente, el mes y el profesional', async () => {
    await crear('2026-10', 'pr1');
    expect(api.planilla).toHaveBeenCalledWith('pa1', '2026-10', 'pr1');
  });

  it('muestra los datos del financiador y una fila por turno, con la asistencia ya marcada', async () => {
    const { el } = await crear();
    expect(el.textContent).toContain('octubre de 2026');
    expect(el.textContent).toContain('OSEP');
    expect(el.textContent).toContain('CUD');
    expect(el.textContent).toContain('123/4');
    const filas = Array.from(el.querySelectorAll('tbody tr'));
    expect(filas).toHaveLength(2);
    expect(filas[0].textContent).toContain('05/10');
    expect(filas[0].textContent).toContain('10:00 a 10:45');
    expect(filas[0].textContent).toContain('Presente');
    // Lo pendiente queda en blanco para completar a mano.
    expect(filas[1].querySelectorAll('td')[2].textContent?.trim()).toBe('');
    // Con un solo profesional no hace falta la columna.
    expect(el.querySelectorAll('thead th')).toHaveLength(4);
  });

  it('con varios profesionales agrega la columna de profesional', async () => {
    api.planilla.mockResolvedValue(
      planilla({
        profesionales: [PROF, OTRO],
        filas: [
          {
            turnoId: 't1',
            fecha: '2026-10-05',
            hora: '10:00',
            horaFin: '10:45',
            profesional: OTRO,
            estado: 'ausente_con_aviso',
          },
        ],
      }),
    );
    const { el } = await crear();
    expect(el.querySelectorAll('thead th')).toHaveLength(5);
    expect(el.querySelector('tbody tr')!.textContent).toContain('Paz');
  });

  it('avisa si no hay turnos en el mes', async () => {
    api.planilla.mockResolvedValue(planilla({ filas: [] }));
    const { el } = await crear();
    expect(el.textContent).toContain('No hay turnos agendados en octubre de 2026.');
  });

  it('muestra el error si no se puede armar', async () => {
    api.planilla.mockRejectedValue(
      new HttpErrorResponse({ status: 404, error: { message: 'Paciente no encontrado' } }),
    );
    const { el } = await crear();
    expect(el.querySelector('[role=alert]')?.textContent).toContain('Paciente no encontrado');
  });

  it('mes anterior y siguiente cambian el mes de la URL (también entre años)', async () => {
    const { el } = await crear('2026-01');
    const navegar = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const boton = (texto: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(texto))!;
    boton('Mes anterior').click();
    expect(navegar).toHaveBeenLastCalledWith([], {
      queryParams: { mes: '2025-12' },
      queryParamsHandling: 'merge',
    });
    boton('Mes siguiente').click();
    expect(navegar).toHaveBeenLastCalledWith([], {
      queryParams: { mes: '2026-02' },
      queryParamsHandling: 'merge',
    });
  });
});

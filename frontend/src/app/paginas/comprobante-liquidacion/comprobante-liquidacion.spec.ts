import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CobrosApi, LiquidacionesApi } from '../../core/api/api';
import type { LiquidacionProfesional, Prestacion } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { ComprobanteLiquidacion, textoComprobante } from './comprobante-liquidacion';

const LIQ: LiquidacionProfesional = {
  profesional: { id: 'p1', nombre: 'Laura', apellido: 'Díaz', disciplina: 'Psicología' },
  sesiones: 2,
  faltazos: 0,
  montoFaltazos: 0,
  facturado: 30000,
  cobrado: 30000,
  alquiler: 9000,
  componentes: [{ tipo: 'porcentaje', valor: 30, base: 30000, monto: 9000 }],
  cobraElCentro: true,
  saldo: 21000,
  acuerdo: { id: 'a1', vigenteDesde: '2026-01', nota: null },
  liquidacion: { id: 'l1', estado: 'cerrada', cerradaEn: '2026-11-01T10:00:00Z', pagadaEn: null },
  sinMarcar: 0,
  sinPrestacion: 0,
};

function sesion(id: string, fecha: string, monto: number, obra: string | null): Prestacion {
  return {
    id,
    fecha,
    hora: '10:00',
    monto,
    paciente: { id: 'pa', nombre: 'Tomás', apellido: 'Paz' },
    financiador: obra ? { id: 'f', nombre: obra } : null,
  } as Prestacion;
}

describe('ComprobanteLiquidacion', () => {
  const listar = vi.fn();
  const prestaciones = vi.fn();

  beforeEach(async () => {
    listar.mockReset().mockResolvedValue([LIQ]);
    prestaciones
      .mockReset()
      .mockResolvedValue([
        sesion('s2', '2026-10-20', 15000, null),
        sesion('s1', '2026-10-06', 15000, 'OSEP'),
      ]);
    await TestBed.configureTestingModule({
      imports: [ComprobanteLiquidacion],
      providers: [
        provideRouter([]),
        { provide: LiquidacionesApi, useValue: { listar } },
        { provide: CobrosApi, useValue: { prestaciones } },
        {
          provide: AuthService,
          useValue: { sesion: () => ({ centro: { nombre: 'Centro Norte' } }) },
        },
      ],
    }).compileComponents();
  });

  async function crear() {
    const fixture = TestBed.createComponent(ComprobanteLiquidacion);
    fixture.componentRef.setInput('profesionalId', 'p1');
    fixture.componentRef.setInput('mes', '2026-10');
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('pide las sesiones del profesional y el mes', async () => {
    await crear();
    expect(listar).toHaveBeenCalledWith('2026-10');
    expect(prestaciones).toHaveBeenCalledWith({ mes: '2026-10', profesionalId: 'p1' });
  });

  it('muestra las sesiones ordenadas por fecha y los totales', async () => {
    const el = await crear();
    const filas = Array.from(el.querySelectorAll('tbody tr')).map((f) => f.textContent ?? '');
    expect(filas).toHaveLength(2);
    expect(filas[0]).toContain('06/10');
    expect(filas[0]).toContain('OSEP');
    expect(filas[1]).toContain('Particular');
    expect(el.textContent).toContain('Díaz, Laura');
    expect(el.textContent).toContain('Generada');
    expect(el.textContent).toContain('30 % de lo facturado');
    expect(el.textContent).toContain('El centro le paga');
    expect(el.textContent).not.toContain('Borrador');
  });

  it('avisa que es borrador si la liquidación no está generada', async () => {
    listar.mockResolvedValue([{ ...LIQ, liquidacion: null }]);
    const el = await crear();
    expect(el.textContent).toContain('Borrador');
  });

  it('arma el texto para WhatsApp', () => {
    const texto = textoComprobante('Centro Norte', '2026-10', LIQ);
    expect(texto).toContain('Centro Norte · Liquidación de');
    expect(texto).toContain('Laura Díaz (Psicología)');
    expect(texto).toContain('Sesiones: 2');
    expect(texto).toContain('Alquiler · 30 % de lo facturado');
    expect(texto).toMatch(/El centro le paga: \$\s?21\.000/);
  });

  it('si cobra el profesional, el texto dice cuánto le debe al centro', () => {
    const texto = textoComprobante('C', '2026-10', {
      ...LIQ,
      cobraElCentro: false,
      componentes: [{ tipo: 'fijo', valor: 50000, base: null, monto: 50000 }],
      alquiler: 50000,
      saldo: -50000,
    });
    expect(texto).toContain('Cuota fija mensual');
    expect(texto).toContain('Cobra el profesional');
    expect(texto).toMatch(/Le debe al centro: \$\s?50\.000/);
  });
});

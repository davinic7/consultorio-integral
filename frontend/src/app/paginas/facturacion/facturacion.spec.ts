import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FacturacionApi } from '../../core/api/api';
import type { ConfigFiscal } from '../../core/api/modelos';
import type { Rol } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { Facturacion } from './facturacion';

function config(extra: Partial<ConfigFiscal> = {}): ConfigFiscal {
  return {
    profesionalId: null,
    facturaCadaProfesional: false,
    cuit: null,
    razonSocial: null,
    domicilio: null,
    inicioActividades: null,
    ptoVta: 1,
    modo: 'simulado',
    textoItem: 'Honorarios por sesión',
    tieneClave: false,
    tieneCertificado: false,
    certificadoVence: null,
    ...extra,
  };
}

describe('Facturacion', () => {
  const api = {
    config: vi.fn(),
    emisores: vi.fn(),
    pendientes: vi.fn(),
    facturas: vi.fn(),
  };

  async function crear(rol: Rol) {
    await TestBed.configureTestingModule({
      imports: [Facturacion],
      providers: [
        provideRouter([]),
        { provide: FacturacionApi, useValue: api },
        {
          provide: AuthService,
          useValue: {
            sesion: () => ({ rol, centro: { zonaHoraria: 'America/Argentina/Catamarca' } }),
          },
        },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Facturacion);
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    Object.values(api).forEach((f) => f.mockReset());
    api.pendientes.mockResolvedValue([]);
    api.facturas.mockResolvedValue([]);
  });

  it('si factura el centro, pide pendientes sin profesional', async () => {
    api.config.mockResolvedValue(config());
    await crear('admin');
    expect(api.emisores).not.toHaveBeenCalled();
    expect(api.pendientes).toHaveBeenCalledWith(expect.any(String), undefined, false);
  });

  it('si factura cada profesional, admin elige el emisor y se pide con su id', async () => {
    api.config.mockImplementation(async (id?: string) =>
      id
        ? config({ profesionalId: id, facturaCadaProfesional: true, cuit: '27111111111' })
        : config({ facturaCadaProfesional: true }),
    );
    api.emisores.mockResolvedValue([
      {
        profesional: { id: 'p1', nombre: 'Laura', apellido: 'Díaz', disciplina: 'Psicología' },
        cuit: '27111111111',
        modo: 'simulado',
        tieneCertificado: false,
      },
    ]);
    const el = await crear('admin');
    expect(api.config).toHaveBeenCalledWith('p1');
    expect(api.pendientes).toHaveBeenCalledWith(expect.any(String), 'p1', false);
    expect(api.facturas).toHaveBeenCalledWith(expect.any(String), 'p1');
    expect(el.textContent).toContain('Profesional que factura');
    expect(el.textContent).toContain('Díaz, Laura');
  });

  it('el profesional ve sus datos sin elegir emisor', async () => {
    api.config.mockResolvedValue(config({ profesionalId: 'p1', facturaCadaProfesional: true }));
    const el = await crear('profesional');
    expect(api.emisores).not.toHaveBeenCalled();
    expect(api.pendientes).toHaveBeenCalledWith(expect.any(String), undefined, false);
    expect(el.textContent).toContain('con tu propio CUIT');
  });

  it('si factura el centro, al profesional le explica que no le corresponde', async () => {
    api.config.mockRejectedValue(new HttpErrorResponse({ status: 403 }));
    const el = await crear('profesional');
    expect(el.textContent).toContain('En este centro factura la administración');
    expect(api.pendientes).not.toHaveBeenCalled();
  });
});

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { TrabajoDictado } from '../../core/api/modelos';
import type { Pendiente } from '../../core/dictado/cola';
import { DictadoService, type FaseDictado } from '../../core/dictado/dictado.service';
import { PildoraDictado } from './pildora-dictado';

describe('Píldora del dictado', () => {
  const d = {
    fase: signal<FaseDictado>('inactivo'),
    paciente: signal<{ id: string; nombre: string } | null>(null),
    segundos: signal(0),
    subida: signal(0),
    trabajo: signal<TrabajoDictado | null>(null),
    pendientes: signal<Pendiente[]>([]),
  };

  beforeEach(async () => {
    d.fase.set('inactivo');
    d.paciente.set(null);
    d.pendientes.set([]);
    await TestBed.configureTestingModule({
      imports: [PildoraDictado],
      providers: [provideRouter([]), { provide: DictadoService, useValue: d }],
    }).compileComponents();
  });

  function crear() {
    const fixture = TestBed.createComponent(PildoraDictado);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('sin dictado ni pendientes no muestra nada', () => {
    expect(crear().textContent?.trim()).toBe('');
  });

  it('grabando muestra el tiempo y lleva al expediente del paciente', () => {
    d.fase.set('grabando');
    d.paciente.set({ id: 'p1', nombre: 'Lucía' });
    d.segundos.set(167);
    const enlace = crear().querySelector('a')!;
    expect(enlace.textContent).toContain('GRABANDO · 02:47');
    expect(enlace.classList).toContain('pil--vivo');
    expect(enlace.getAttribute('href')).toBe('/pacientes/p1?pestana=expediente');
    expect(enlace.getAttribute('aria-label')).toBe('Dictado de Lucía: grabando. Ir al expediente');
  });

  it('con grabaciones esperando señal, las cuenta', () => {
    d.pendientes.set([{ id: 'a' } as Pendiente, { id: 'b' } as Pendiente]);
    expect(crear().textContent).toContain('2 SIN ENVIAR');
  });
});

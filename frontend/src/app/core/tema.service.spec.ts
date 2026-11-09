import { TestBed } from '@angular/core/testing';
import { TemaService } from './tema.service';

describe('TemaService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-tema');
  });

  it('sin elección guardada no fuerza ningún tema', () => {
    const tema = TestBed.inject(TemaService);
    TestBed.tick();
    expect(tema.tema()).toBeNull();
    expect(document.documentElement.hasAttribute('data-tema')).toBe(false);
  });

  it('alternar fija el tema, lo guarda y lo aplica en <html>', () => {
    const tema = TestBed.inject(TemaService);
    const eraOscuro = tema.esOscuro();
    tema.alternar();
    TestBed.tick();
    const esperado = eraOscuro ? 'claro' : 'oscuro';
    expect(document.documentElement.getAttribute('data-tema')).toBe(esperado);
    expect(localStorage.getItem('ci-tema')).toBe(esperado);
    expect(tema.esOscuro()).toBe(!eraOscuro);
  });

  it('recupera la elección guardada', () => {
    localStorage.setItem('ci-tema', 'claro');
    const tema = TestBed.inject(TemaService);
    expect(tema.tema()).toBe('claro');
    expect(tema.esOscuro()).toBe(false);
  });
});

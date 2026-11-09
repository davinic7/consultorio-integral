import { TestBed } from '@angular/core/testing';
import { TokenStorage } from './token-storage';

describe('TokenStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('por defecto recuerda la sesión en este equipo', () => {
    const s = TestBed.inject(TokenStorage);
    s.guardar('t1');
    expect(localStorage.getItem('ci.refreshToken')).toBe('t1');
    expect(s.leer()).toBe('t1');
  });

  it('sin "recordarme" la guarda solo para esta pestaña', () => {
    const s = TestBed.inject(TokenStorage);
    s.recordar(false);
    s.guardar('t2');
    expect(localStorage.getItem('ci.refreshToken')).toBeNull();
    expect(sessionStorage.getItem('ci.refreshToken')).toBe('t2');
    expect(s.leer()).toBe('t2');
  });

  it('al renovar sigue en el mismo lugar, y borrar limpia los dos', () => {
    sessionStorage.setItem('ci.refreshToken', 'viejo');
    const s = TestBed.inject(TokenStorage);
    s.guardar('nuevo');
    expect(sessionStorage.getItem('ci.refreshToken')).toBe('nuevo');
    expect(localStorage.getItem('ci.refreshToken')).toBeNull();
    s.borrar();
    expect(s.leer()).toBeNull();
  });
});

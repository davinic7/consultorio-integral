import { TestBed } from '@angular/core/testing';
import { MARCA_SESION, TokenStorage } from './token-storage';

describe('TokenStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('por defecto recuerda la sesión en este equipo', () => {
    const s = TestBed.inject(TokenStorage);
    s.guardar();
    expect(localStorage.getItem('ci.refreshToken')).toBe(MARCA_SESION);
    expect(s.leer()).toBe(MARCA_SESION);
    expect(s.recuerda()).toBe(true);
  });

  it('sin "recordarme" la guarda solo para esta pestaña', () => {
    const s = TestBed.inject(TokenStorage);
    s.recordar(false);
    s.guardar();
    expect(localStorage.getItem('ci.refreshToken')).toBeNull();
    expect(sessionStorage.getItem('ci.refreshToken')).toBe(MARCA_SESION);
    expect(s.recuerda()).toBe(false);
  });

  it('al renovar sigue en el mismo lugar, y borrar limpia los dos', () => {
    sessionStorage.setItem('ci.refreshToken', 'viejo');
    const s = TestBed.inject(TokenStorage);
    s.guardar();
    expect(sessionStorage.getItem('ci.refreshToken')).toBe(MARCA_SESION);
    expect(localStorage.getItem('ci.refreshToken')).toBeNull();
    s.borrar();
    expect(s.leer()).toBeNull();
  });
});

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { TrabajoDictado } from '../../core/api/modelos';
import type { Pendiente } from '../../core/dictado/cola';
import { DictadoService, type FaseDictado } from '../../core/dictado/dictado.service';
import { DictadoPanel, mmss } from './dictado-panel';

/** Servicio de dictado falso: cada test fija el estado que quiere ver. */
function dictadoFalso() {
  return {
    fase: signal<FaseDictado>('listo'),
    paciente: signal<{ id: string; nombre: string } | null>({ id: 'p1', nombre: 'Lucía' }),
    segundos: signal(0),
    nivel: signal(0),
    pausaPorBloqueo: signal(false),
    subida: signal(0),
    trabajo: signal<TrabajoDictado | null>(null),
    codigoError: signal<string | null>(null),
    mensajeError: signal<string | null>(null),
    pendientes: signal<Pendiente[]>([]),
    pedirPermiso: vi.fn(),
    empezar: vi.fn(),
    pausar: vi.fn(),
    reanudar: vi.fn(),
    terminar: vi.fn(),
    reintentar: vi.fn(),
    descartarPendiente: vi.fn(),
  };
}

function pendiente(id: string, pacienteId: string): Pendiente {
  return {
    id,
    centroId: 'c1',
    usuarioId: 'u1',
    pacienteId,
    turnoId: null,
    duracionSeg: 167,
    creadoEn: '2026-11-12T14:05:00Z',
    versionClave: 1,
    paquete: new ArrayBuffer(0),
    intentos: 0,
  };
}

describe('Panel de dictado', () => {
  let d: ReturnType<typeof dictadoFalso>;

  beforeEach(async () => {
    d = dictadoFalso();
    await TestBed.configureTestingModule({
      imports: [DictadoPanel],
      providers: [{ provide: DictadoService, useValue: d }],
    }).compileComponents();
  });

  function crear() {
    const fixture = TestBed.createComponent(DictadoPanel);
    fixture.componentRef.setInput('zona', 'America/Argentina/Catamarca');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const boton = (texto: string) =>
      Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.includes(texto)) as
        HTMLButtonElement | undefined;
    return { fixture, el, boton };
  }

  it('formatea el tiempo en minutos y segundos', () => {
    expect(mmss(167)).toBe('02:47');
    expect(mmss(600)).toBe('10:00');
  });

  it('explica el permiso del micrófono antes de pedirlo', () => {
    d.fase.set('permiso');
    const { fixture, el, boton } = crear();
    const escribir = vi.fn();
    fixture.componentInstance.escribir.subscribe(escribir);
    expect(el.textContent).toContain('Antes de dictar');
    expect(el.textContent).toContain('El audio no se guarda');
    boton('Permitir el micrófono')!.click();
    expect(d.pedirPermiso).toHaveBeenCalled();
    boton('Prefiero escribir')!.click();
    expect(escribir).toHaveBeenCalled();
  });

  it('grabando se ve con texto, ícono y tiempo, y los controles responden', () => {
    d.fase.set('grabando');
    d.segundos.set(167);
    const { fixture, el, boton } = crear();
    const descartar = vi.fn();
    fixture.componentInstance.descartar.subscribe(descartar);
    expect(el.querySelector('.dic__franja')?.textContent).toContain('GRABANDO');
    expect(el.querySelector('[role="timer"]')?.textContent).toBe('02:47');
    expect(el.textContent).toContain('quedan 07:13');
    expect(el.textContent).not.toContain('Queda menos de un minuto');
    boton('Terminar')!.click();
    boton('Pausar')!.click();
    boton('Descartar')!.click();
    expect(d.terminar).toHaveBeenCalled();
    expect(d.pausar).toHaveBeenCalled();
    expect(descartar).toHaveBeenCalled();
  });

  it('avisa cuando queda menos de un minuto', () => {
    d.fase.set('grabando');
    d.segundos.set(545);
    const { el } = crear();
    expect(el.textContent).toContain('Queda menos de un minuto');
    expect(el.querySelector('.dic__avance--casi')).not.toBeNull();
  });

  it('en pausa por bloquear la pantalla, ofrece reanudar', () => {
    d.fase.set('pausado');
    d.segundos.set(60);
    d.pausaPorBloqueo.set(true);
    const { el, boton } = crear();
    expect(el.querySelector('.dic__franja')?.textContent).toContain('EN PAUSA');
    expect(el.textContent).toContain('Se pausó al bloquear la pantalla');
    boton('Reanudar')!.click();
    expect(d.reanudar).toHaveBeenCalled();
  });

  it('muestra el progreso real de la transcripción', () => {
    d.fase.set('transcribiendo');
    d.trabajo.set({
      id: 't1',
      estado: 'transcribiendo',
      duracionSeg: 100,
      procesadoSeg: 60,
      antes: 0,
      dudosas: [],
      codigo: null,
      sinTexto: false,
    });
    const { el } = crear();
    expect(el.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('60');
    expect(el.textContent).toContain('01:00 de 01:40');
  });

  it('sin señal lista lo que espera, sin mostrar otros pacientes por nombre', () => {
    d.fase.set('sin_conexion');
    d.pendientes.set([pendiente('a', 'p1'), pendiente('b', 'p2')]);
    const { el } = crear();
    expect(el.textContent).toContain('No hay señal');
    expect(el.textContent).toContain('EN ESPERA · 2');
    const filas = Array.from(el.querySelectorAll('.dic__cola li')).map((li) => li.textContent);
    expect(filas[0]).toContain('Lucía');
    expect(filas[1]).toContain('Otro paciente');
    expect(filas[0]).toContain('02:47 de audio');
  });

  it('ante un error ofrece reintentar sin perder la grabación', () => {
    d.fase.set('error');
    d.codigoError.set('TR-02');
    const { el, boton } = crear();
    expect(el.textContent).toContain('No se pudo transcribir');
    expect(el.textContent).toContain('no se perdió nada');
    expect(el.textContent).toContain('Código TR-02');
    boton('Reintentar')!.click();
    expect(d.reintentar).toHaveBeenCalled();
  });
});

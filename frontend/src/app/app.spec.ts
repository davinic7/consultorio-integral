import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('muestra el estado cuando la API y la base responden', async () => {
    const fixture = TestBed.createComponent(App);
    http.expectOne('/api/v1/health').flush({ status: 'ok', db: 'up' });
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('h1')?.textContent).toContain('Centro Integral');
    expect(el.querySelector('.estado')?.getAttribute('data-estado')).toBe('ok');
  });

  it('avisa si la API no responde', async () => {
    const fixture = TestBed.createComponent(App);
    http.expectOne('/api/v1/health').error(new ProgressEvent('error'));
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.estado')?.getAttribute('data-estado')).toBe('sin-api');
  });
});

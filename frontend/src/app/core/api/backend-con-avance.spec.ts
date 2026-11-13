import { FetchBackend, HttpRequest, HttpXhrBackend } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { BackendConAvance } from './backend-con-avance';

describe('Backend con avance', () => {
  it('manda por XMLHttpRequest solo las subidas que informan su avance', () => {
    const fetch = { handle: vi.fn(() => of()) };
    const xhr = { handle: vi.fn(() => of()) };
    TestBed.configureTestingModule({
      providers: [
        { provide: FetchBackend, useValue: fetch },
        { provide: HttpXhrBackend, useValue: xhr },
      ],
    });
    const backend = TestBed.inject(BackendConAvance);
    const comun = new HttpRequest('GET', '/api/v1/pacientes');
    const subida = new HttpRequest('POST', '/api/v1/pacientes/p1/dictados', new ArrayBuffer(4), {
      reportUploadProgress: true,
    });

    backend.handle(comun);
    backend.handle(subida);

    expect(fetch.handle).toHaveBeenCalledTimes(1);
    expect(fetch.handle).toHaveBeenCalledWith(comun);
    expect(xhr.handle).toHaveBeenCalledTimes(1);
    expect(xhr.handle).toHaveBeenCalledWith(subida);
  });
});

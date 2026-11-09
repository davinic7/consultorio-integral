import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { mensajeDeError, PacientesApi } from '../../core/api/api';
import type { Paciente } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { puede } from '../../core/auth/roles';

const POR_PAGINA = 20;

@Component({
  selector: 'app-pacientes',
  imports: [RouterLink],
  templateUrl: './pacientes.html',
})
export class Pacientes {
  /** Búsqueda que llega por la URL (?q=…), por ejemplo desde el buscador de la barra. */
  readonly q = input<string>();

  private readonly api = inject(PacientesApi);
  private readonly auth = inject(AuthService);

  protected readonly puedeEditar = computed(() =>
    puede(this.auth.sesion()?.rol, 'admin', 'recepcion'),
  );
  protected readonly esProfesional = computed(() => this.auth.sesion()?.rol === 'profesional');
  protected readonly pacientes = signal<Paciente[]>([]);
  protected readonly total = signal(0);
  protected readonly pagina = signal(1);
  protected readonly filtro = signal('');
  protected readonly verInactivos = signal(false);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly paginas = computed(() => Math.max(1, Math.ceil(this.total() / POR_PAGINA)));

  private readonly busqueda = new Subject<string>();

  constructor() {
    const sub = this.busqueda.pipe(debounceTime(300), distinctUntilChanged()).subscribe((q) => {
      this.filtro.set(q);
      this.pagina.set(1);
      void this.cargar();
    });
    inject(DestroyRef).onDestroy(() => sub.unsubscribe());
    // Carga inicial y cada vez que cambia la búsqueda de la URL.
    effect(() => {
      const q = (this.q() ?? '').trim();
      untracked(() => {
        this.filtro.set(q);
        this.pagina.set(1);
        void this.cargar();
      });
    });
  }

  protected buscar(texto: string): void {
    this.busqueda.next(texto.trim());
  }

  protected irA(pagina: number): void {
    this.pagina.set(pagina);
    void this.cargar();
  }

  protected alternarInactivos(): void {
    this.verInactivos.update((v) => !v);
    this.pagina.set(1);
    void this.cargar();
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set(null);
    try {
      const r = await this.api.listar({
        q: this.filtro(),
        pagina: this.pagina(),
        porPagina: POR_PAGINA,
        incluirInactivos: this.verInactivos() || undefined,
      });
      this.pacientes.set(r.items);
      this.total.set(r.total);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar los pacientes.'));
    } finally {
      this.cargando.set(false);
    }
  }
}

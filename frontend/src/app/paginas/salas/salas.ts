import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { mensajeDeError, SalasApi } from '../../core/api/api';
import type { Sala } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { puede } from '../../core/auth/roles';

@Component({
  selector: 'app-salas',
  imports: [ReactiveFormsModule],
  templateUrl: './salas.html',
})
export class Salas implements OnInit {
  private readonly api = inject(SalasApi);
  private readonly auth = inject(AuthService);

  protected readonly esAdmin = computed(() => puede(this.auth.sesion()?.rol, 'admin'));
  protected readonly salas = signal<Sala[]>([]);
  protected readonly cargando = signal(true);
  protected readonly verInactivas = signal(false);
  protected readonly editando = signal<Sala | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly guardando = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group({
    nombre: ['', [Validators.required, Validators.maxLength(80)]],
    descripcion: ['', Validators.maxLength(255)],
  });

  ngOnInit(): void {
    void this.cargar();
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.salas.set(await this.api.listar(this.verInactivas()));
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar las salas.'));
    } finally {
      this.cargando.set(false);
    }
  }

  protected alternarInactivas(): void {
    this.verInactivas.update((v) => !v);
    void this.cargar();
  }

  protected editar(sala: Sala): void {
    this.editando.set(sala);
    this.form.setValue({ nombre: sala.nombre, descripcion: sala.descripcion ?? '' });
    this.error.set(null);
  }

  protected cancelar(): void {
    this.editando.set(null);
    this.form.reset();
    this.error.set(null);
  }

  protected async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    try {
      const datos = this.form.getRawValue();
      const actual = this.editando();
      if (actual) await this.api.actualizar(actual.id, datos);
      else await this.api.crear(datos);
      this.cancelar();
      await this.cargar();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async alternarActiva(sala: Sala): Promise<void> {
    try {
      await this.api.actualizar(sala.id, { activa: !sala.activa });
      await this.cargar();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    }
  }
}

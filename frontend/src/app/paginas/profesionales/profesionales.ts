import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { mensajeDeError, ProfesionalesApi, UsuariosApi } from '../../core/api/api';
import type { Miembro, Profesional } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { tieneModulo } from '../../core/auth/modulos';
import { puede } from '../../core/auth/roles';
import { AcuerdoProfesional } from './acuerdo-profesional';

@Component({
  selector: 'app-profesionales',
  imports: [ReactiveFormsModule, AcuerdoProfesional],
  templateUrl: './profesionales.html',
})
export class Profesionales implements OnInit {
  private readonly api = inject(ProfesionalesApi);
  private readonly auth = inject(AuthService);
  private readonly usuariosApi = inject(UsuariosApi);

  protected readonly esAdmin = computed(() => puede(this.auth.sesion()?.rol, 'admin'));
  /** Los acuerdos de alquiler van con la liquidación del plan. */
  protected readonly conAcuerdos = computed(
    () => this.esAdmin() && tieneModulo(this.auth.sesion(), 'liquidacion'),
  );
  /** Profesional cuyo acuerdo de alquiler se está viendo. */
  protected readonly acuerdoDe = signal<Profesional | null>(null);
  protected readonly profesionales = signal<Profesional[]>([]);
  protected readonly cargando = signal(true);
  protected readonly verInactivos = signal(false);
  protected readonly formAbierto = signal(false);
  protected readonly editando = signal<Profesional | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly guardando = signal(false);
  /** Usuarios del centro con rol profesional o administración, para vincular su cuenta. */
  protected readonly cuentas = signal<Miembro[]>([]);

  protected readonly form = inject(NonNullableFormBuilder).group({
    nombre: ['', [Validators.required, Validators.maxLength(80)]],
    apellido: ['', [Validators.required, Validators.maxLength(80)]],
    disciplina: ['', [Validators.required, Validators.maxLength(80)]],
    matricula: ['', Validators.maxLength(40)],
    usuarioId: [''],
  });

  ngOnInit(): void {
    void this.cargar();
    if (this.esAdmin()) void this.cargarCuentas();
  }

  private async cargarCuentas(): Promise<void> {
    try {
      const miembros = await this.usuariosApi.listar();
      this.cuentas.set(
        miembros.filter((m) => (m.rol === 'profesional' || m.rol === 'admin') && m.activo),
      );
    } catch {
      this.cuentas.set([]);
    }
  }

  /** Email de la cuenta vinculada, para mostrar en la lista. */
  protected cuentaDe(usuarioId: string | null): string | null {
    return this.cuentas().find((c) => c.usuario.id === usuarioId)?.usuario.email ?? null;
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.profesionales.set(await this.api.listar(this.verInactivos()));
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar los profesionales.'));
    } finally {
      this.cargando.set(false);
    }
  }

  protected alternarInactivos(): void {
    this.verInactivos.update((v) => !v);
    void this.cargar();
  }

  protected nuevo(): void {
    this.editando.set(null);
    this.form.reset();
    this.formAbierto.set(true);
    this.error.set(null);
  }

  protected editar(p: Profesional): void {
    this.editando.set(p);
    this.form.setValue({
      nombre: p.nombre,
      apellido: p.apellido,
      disciplina: p.disciplina,
      matricula: p.matricula ?? '',
      usuarioId: p.usuarioId ?? '',
    });
    this.formAbierto.set(true);
    this.error.set(null);
  }

  protected verAcuerdo(p: Profesional): void {
    this.formAbierto.set(false);
    this.acuerdoDe.set(p);
  }

  protected cerrar(): void {
    this.formAbierto.set(false);
    this.editando.set(null);
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
      const { usuarioId, ...resto } = this.form.getRawValue();
      const datos = { ...resto, usuarioId: usuarioId || null };
      const actual = this.editando();
      if (actual) await this.api.actualizar(actual.id, datos);
      else await this.api.crear(datos);
      this.cerrar();
      await this.cargar();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async alternarActivo(p: Profesional): Promise<void> {
    try {
      await this.api.actualizar(p.id, { activo: !p.activo });
      await this.cargar();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    }
  }
}

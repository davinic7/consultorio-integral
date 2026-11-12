import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { mensajeDeError, UsuariosApi } from '../../core/api/api';
import type { DatosMiembro, Miembro } from '../../core/api/modelos';
import type { Rol } from '../../core/auth/auth.models';
import { AuthService } from '../../core/auth/auth.service';
import { NOMBRE_ROL } from '../../core/auth/roles';

const ROLES: Rol[] = ['admin', 'recepcion', 'profesional'];

/**
 * Personas con acceso al centro (solo administración): alta, cambio de rol y baja.
 * Si el email ya tiene cuenta en otro centro, se reutiliza y no hace falta contraseña.
 */
@Component({
  selector: 'app-usuarios',
  imports: [ReactiveFormsModule],
  templateUrl: './usuarios.html',
})
export class Usuarios implements OnInit {
  private readonly api = inject(UsuariosApi);
  private readonly auth = inject(AuthService);

  protected readonly roles = ROLES;
  protected readonly nombreRol = NOMBRE_ROL;
  protected readonly miembros = signal<Miembro[]>([]);
  protected readonly cargando = signal(true);
  protected readonly verInactivos = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly aviso = signal<string | null>(null);
  protected readonly guardando = signal(false);
  /** Miembro con una acción en curso, para no repetir clics. */
  protected readonly ocupado = signal<string | null>(null);

  protected readonly visibles = computed(() =>
    this.verInactivos() ? this.miembros() : this.miembros().filter((m) => m.activo),
  );
  protected readonly cantidadInactivos = computed(
    () => this.miembros().filter((m) => !m.activo).length,
  );

  protected readonly form = inject(NonNullableFormBuilder).group({
    nombre: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    rol: ['recepcion' as Rol, Validators.required],
    password: ['', [Validators.minLength(10), Validators.maxLength(200)]],
  });

  ngOnInit(): void {
    void this.cargar();
  }

  /** El admin no puede cambiarse el rol ni darse de baja a sí mismo. */
  protected esYo(m: Miembro): boolean {
    return m.usuario.id === this.auth.sesion()?.usuario.id;
  }

  protected async cargar(): Promise<void> {
    this.cargando.set(true);
    try {
      this.miembros.set(await this.api.listar());
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar los usuarios.'));
    } finally {
      this.cargando.set(false);
    }
  }

  protected async agregar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.aviso.set(null);
    try {
      const { password, ...resto } = this.form.getRawValue();
      const datos: DatosMiembro = { ...resto, password: password || undefined };
      const nuevo = await this.api.crear(datos);
      this.aviso.set(
        `${nuevo.usuario.nombre} ya puede ingresar como ${NOMBRE_ROL[nuevo.rol]}.` +
          (password ? '' : ' Usa la contraseña que ya tenía.'),
      );
      this.form.reset();
      await this.cargar();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async cambiarRol(m: Miembro, rol: string): Promise<void> {
    if (rol === m.rol) return;
    await this.actualizar(m, { rol: rol as Rol });
  }

  protected async alternarActivo(m: Miembro): Promise<void> {
    if (m.activo && !confirm(`¿Quitarle el acceso al centro a ${m.usuario.nombre}?`)) return;
    await this.actualizar(m, { activo: !m.activo });
  }

  private async actualizar(m: Miembro, datos: Partial<Pick<Miembro, 'rol' | 'activo'>>) {
    this.ocupado.set(m.id);
    this.error.set(null);
    this.aviso.set(null);
    try {
      const actualizado = await this.api.actualizar(m.id, datos);
      this.miembros.update((lista) => lista.map((x) => (x.id === m.id ? actualizado : x)));
    } catch (e) {
      // Recarga para que el select de rol vuelva al valor real.
      await this.cargar();
      this.error.set(mensajeDeError(e));
    } finally {
      this.ocupado.set(null);
    }
  }
}

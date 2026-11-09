import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { FinanciadoresApi, mensajeDeError } from '../../core/api/api';
import type { DatosFinanciador, Financiador, TipoFinanciador } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';

export const NOMBRE_TIPO: Record<TipoFinanciador, string> = {
  obra_social: 'Obra social',
  prepaga: 'Prepaga',
  cud: 'CUD',
  particular: 'Particular',
};

const nuloSiVacio = (v: number | null | string) =>
  v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v);

/**
 * Obras sociales, prepagas y CUD del centro con sus reglas. Las ven todos; las
 * administra el admin. Las órdenes y los tokens se cargan con el módulo de cobros.
 */
@Component({
  selector: 'app-financiadores',
  imports: [ReactiveFormsModule],
  templateUrl: './financiadores.html',
  styles: `
    .reglas {
      display: flex;
      flex-wrap: wrap;
      gap: 0.375rem;
      margin-top: 0.375rem;
    }
    .item {
      flex-wrap: wrap;
    }
    .item__datos {
      flex: 1 1 260px;
      min-width: 0;
    }
    .item__nombre {
      font-weight: 600;
    }
    .opciones {
      display: flex;
      flex-wrap: wrap;
      gap: 0 1.5rem;
    }
    .form {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }
  `,
})
export class Financiadores implements OnInit {
  private readonly api = inject(FinanciadoresApi);
  private readonly auth = inject(AuthService);

  protected readonly esAdmin = computed(() => this.auth.sesion()?.rol === 'admin');
  protected readonly financiadores = signal<Financiador[]>([]);
  protected readonly verInactivos = signal(false);
  protected readonly editando = signal<Financiador | null>(null);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly nombreTipo = NOMBRE_TIPO;
  protected readonly tipos = Object.keys(NOMBRE_TIPO) as TipoFinanciador[];

  protected readonly form = inject(NonNullableFormBuilder).group({
    nombre: ['', [Validators.required, Validators.maxLength(120)]],
    tipo: ['obra_social' as TipoFinanciador],
    codigoPrestacion: ['', Validators.maxLength(40)],
    requiereOrden: [false],
    requiereToken: [false],
    maxSesionesSemana: [null as number | null, [Validators.min(1), Validators.max(14)]],
    diasValidezOrden: [null as number | null, [Validators.min(1), Validators.max(365)]],
    observaciones: ['', Validators.maxLength(500)],
  });

  ngOnInit(): void {
    void this.cargar();
  }

  protected alternarInactivos(): void {
    this.verInactivos.update((v) => !v);
    void this.cargar();
  }

  protected editar(f: Financiador): void {
    this.editando.set(f);
    this.form.reset({
      nombre: f.nombre,
      tipo: f.tipo,
      codigoPrestacion: f.codigoPrestacion ?? '',
      requiereOrden: f.requiereOrden,
      requiereToken: f.requiereToken,
      maxSesionesSemana: f.maxSesionesSemana,
      diasValidezOrden: f.diasValidezOrden,
      observaciones: f.observaciones ?? '',
    });
    this.error.set(null);
  }

  protected cancelar(): void {
    this.editando.set(null);
    this.form.reset();
  }

  protected async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const datos: DatosFinanciador = {
      nombre: v.nombre.trim(),
      tipo: v.tipo,
      codigoPrestacion: v.codigoPrestacion.trim() || null,
      requiereOrden: v.requiereOrden,
      requiereToken: v.requiereToken,
      maxSesionesSemana: nuloSiVacio(v.maxSesionesSemana),
      diasValidezOrden: nuloSiVacio(v.diasValidezOrden),
      observaciones: v.observaciones.trim() || null,
    };
    this.guardando.set(true);
    this.error.set(null);
    try {
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

  protected async alternarActivo(f: Financiador): Promise<void> {
    try {
      await this.api.actualizar(f.id, { activo: !f.activo });
      await this.cargar();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    }
  }

  private async cargar(): Promise<void> {
    try {
      this.financiadores.set(await this.api.listar(this.verInactivos()));
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudieron cargar las obras sociales.'));
    }
  }
}

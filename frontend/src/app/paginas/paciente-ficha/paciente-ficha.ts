import { Component, computed, inject, input, OnInit, signal } from '@angular/core';
import {
  AbstractControl,
  NonNullableFormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { mensajeDeError, PacientesApi, ProfesionalesApi } from '../../core/api/api';
import type { DatosPaciente, Paciente, Profesional } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { puede } from '../../core/auth/roles';
import { AsistenciaPaciente } from './asistencia-paciente';
import { NotasPaciente } from './notas-paciente';

/** Vencimiento de CUD solo si tiene CUD. */
function cudCoherente(g: AbstractControl): ValidationErrors | null {
  const { tieneCud, cudVencimiento } = g.value as { tieneCud: boolean; cudVencimiento: string };
  return !tieneCud && cudVencimiento ? { cud: true } : null;
}

const vacioANull = (s: string) => (s.trim() === '' ? null : s.trim());

@Component({
  selector: 'app-paciente-ficha',
  imports: [ReactiveFormsModule, RouterLink, AsistenciaPaciente, NotasPaciente],
  templateUrl: './paciente-ficha.html',
})
export class PacienteFicha implements OnInit {
  /** Id de la ruta (/pacientes/:id); sin id es un alta. */
  readonly id = input<string>();

  private readonly api = inject(PacientesApi);
  private readonly profesionalesApi = inject(ProfesionalesApi);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

  protected readonly puedeEditar = computed(() =>
    puede(this.auth.sesion()?.rol, 'admin', 'recepcion'),
  );
  protected readonly esAlta = computed(() => !this.id());
  protected readonly esProfesional = computed(() => this.auth.sesion()?.rol === 'profesional');
  protected readonly paciente = signal<Paciente | null>(null);
  protected readonly profesionales = signal<Profesional[]>([]);
  protected readonly asignados = signal<Set<string>>(new Set());
  protected readonly cargando = signal(true);
  protected readonly guardando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly guardado = signal(false);

  protected readonly form = inject(NonNullableFormBuilder).group(
    {
      nombre: ['', [Validators.required, Validators.maxLength(80)]],
      apellido: ['', [Validators.required, Validators.maxLength(80)]],
      dni: ['', Validators.pattern(/^[\d.\s-]{6,13}$/)],
      fechaNacimiento: [''],
      telefono: ['', Validators.maxLength(30)],
      email: ['', [Validators.email, Validators.maxLength(160)]],
      responsableNombre: ['', Validators.maxLength(120)],
      responsableTelefono: ['', Validators.maxLength(30)],
      nroAfiliado: ['', Validators.maxLength(40)],
      tieneCud: [false],
      cudVencimiento: [''],
    },
    { validators: cudCoherente },
  );

  async ngOnInit(): Promise<void> {
    if (!this.puedeEditar()) this.form.disable();
    try {
      const [profesionales, paciente] = await Promise.all([
        this.puedeEditar() ? this.profesionalesApi.listar() : Promise.resolve([]),
        this.id() ? this.api.obtener(this.id()!) : Promise.resolve(null),
      ]);
      this.profesionales.set(profesionales);
      if (paciente) this.mostrar(paciente);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo cargar el paciente.'));
    } finally {
      this.cargando.set(false);
    }
  }

  protected alternarProfesional(id: string): void {
    this.asignados.update((s) => {
      const nuevo = new Set(s);
      if (nuevo.has(id)) nuevo.delete(id);
      else nuevo.add(id);
      return nuevo;
    });
  }

  protected async guardar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.guardando.set(true);
    this.error.set(null);
    this.guardado.set(false);
    try {
      const v = this.form.getRawValue();
      const datos: DatosPaciente = {
        nombre: v.nombre.trim(),
        apellido: v.apellido.trim(),
        dni: vacioANull(v.dni),
        fechaNacimiento: vacioANull(v.fechaNacimiento),
        telefono: vacioANull(v.telefono),
        email: vacioANull(v.email),
        responsableNombre: vacioANull(v.responsableNombre),
        responsableTelefono: vacioANull(v.responsableTelefono),
        nroAfiliado: vacioANull(v.nroAfiliado),
        tieneCud: v.tieneCud,
        cudVencimiento: v.tieneCud ? vacioANull(v.cudVencimiento) : null,
      };
      const ids = [...this.asignados()];
      const actual = this.paciente();
      if (actual) {
        await this.api.actualizar(actual.id, datos);
        await this.api.asignarProfesionales(actual.id, ids);
        this.mostrar(await this.api.obtener(actual.id));
        this.guardado.set(true);
      } else {
        const creado = await this.api.crear({ ...datos, profesionalIds: ids });
        await this.router.navigate(['/pacientes', creado.id]);
      }
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.guardando.set(false);
    }
  }

  protected async alternarActivo(): Promise<void> {
    const actual = this.paciente();
    if (!actual) return;
    try {
      this.mostrar(await this.api.actualizar(actual.id, { activo: !actual.activo }));
    } catch (e) {
      this.error.set(mensajeDeError(e));
    }
  }

  private mostrar(p: Paciente): void {
    this.paciente.set(p);
    this.asignados.set(new Set(p.profesionales.map((x) => x.id)));
    this.form.reset({
      nombre: p.nombre,
      apellido: p.apellido,
      dni: p.dni ?? '',
      fechaNacimiento: p.fechaNacimiento ?? '',
      telefono: p.telefono ?? '',
      email: p.email ?? '',
      responsableNombre: p.responsableNombre ?? '',
      responsableTelefono: p.responsableTelefono ?? '',
      nroAfiliado: p.nroAfiliado ?? '',
      tieneCud: p.tieneCud,
      cudVencimiento: p.cudVencimiento ?? '',
    });
  }
}

import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';
import { TokenStorage } from '../../core/auth/token-storage';
import { Isotipo, SelloDavinic } from '../../core/marca/marca';
import { TemaService } from '../../core/tema.service';

/** Ingreso (Órbita Cian): marca con la órbita a la izquierda y formulario a la derecha. */
@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, Isotipo, SelloDavinic],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly tokens = inject(TokenStorage);
  protected readonly tema = inject(TemaService);
  protected readonly version = environment.version;

  protected readonly form = inject(NonNullableFormBuilder).group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
    recordar: [true],
  });
  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly verClave = signal(false);

  protected async entrar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.enviando.set(true);
    this.error.set(null);
    try {
      const { email, password, recordar } = this.form.getRawValue();
      this.tokens.recordar(recordar);
      const sesion = await this.auth.login(email, password);
      const destino = !sesion.centro && sesion.centros.length > 0 ? '/elegir-centro' : '/';
      await this.router.navigateByUrl(destino);
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.enviando.set(false);
    }
  }
}

function mensajeDeError(e: unknown): string {
  if (e instanceof HttpErrorResponse) {
    if (e.status === 0) return 'No se pudo conectar con el servidor.';
    if (e.status === 429) return 'Demasiados intentos. Esperá un minuto y probá de nuevo.';
    if (e.status === 401) return 'Email o contraseña incorrectos.';
  }
  return 'No se pudo iniciar sesión. Probá de nuevo.';
}

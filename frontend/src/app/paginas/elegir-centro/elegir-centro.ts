import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { NOMBRE_ROL } from '../../core/auth/roles';

@Component({
  selector: 'app-elegir-centro',
  templateUrl: './elegir-centro.html',
})
export class ElegirCentro {
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly nombreRol = NOMBRE_ROL;
  protected readonly eligiendo = signal<string | null>(null);
  protected readonly error = signal(false);

  protected async elegir(centroId: string): Promise<void> {
    this.eligiendo.set(centroId);
    this.error.set(false);
    try {
      await this.auth.cambiarCentro(centroId);
      await this.router.navigateByUrl('/');
    } catch {
      this.error.set(true);
    } finally {
      this.eligiendo.set(null);
    }
  }
}

import {
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CobrosApi, mensajeDeError } from '../../core/api/api';
import type { MedioPago, Prestacion } from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { puede } from '../../core/auth/roles';
import {
  CLASE_COBRO,
  MEDIOS,
  NOMBRE_AVISO,
  NOMBRE_COBRO,
  NOMBRE_MEDIO,
  plata,
} from '../../core/cobros';

/**
 * Diálogo con el detalle de una sesión para cobrar: pagos (registrar, marcar
 * rechazado, borrar), token, monto a mano y si se presentó a la obra social.
 * Se abre al asignar `prestacion` y avisa cada cambio con `cambio`.
 * Lo usan Cobros y la ficha del paciente.
 */
@Component({
  selector: 'app-detalle-cobro',
  imports: [FormsModule],
  templateUrl: './detalle-cobro.html',
  styleUrl: './detalle-cobro.scss',
})
export class DetalleCobro {
  /** Sesión a mostrar; null cierra el diálogo. */
  readonly prestacion = model<Prestacion | null>(null);
  /** La sesión cambió (para recargar la lista de quien lo abrió). */
  readonly cambio = output<Prestacion>();

  private readonly api = inject(CobrosApi);
  private readonly auth = inject(AuthService);
  private readonly dialogo = viewChild.required<ElementRef<HTMLDialogElement>>('dialogo');

  protected readonly gestiona = computed(() =>
    puede(this.auth.sesion()?.rol, 'admin', 'recepcion'),
  );
  protected readonly ocupado = signal(false);
  protected readonly error = signal<string | null>(null);
  protected pago = { medio: 'efectivo' as MedioPago, monto: null as number | null, fecha: '' };
  protected token = '';
  protected montoManual: number | null = null;

  protected readonly plata = plata;
  protected readonly medios = MEDIOS;
  protected readonly nombreMedio = NOMBRE_MEDIO;
  protected readonly nombreCobro = NOMBRE_COBRO;
  protected readonly claseCobro = CLASE_COBRO;
  protected readonly nombreAviso = NOMBRE_AVISO;
  protected readonly diaMes = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

  /** Id de la sesión abierta: los formularios se reinician solo al abrir otra. */
  private abierta: string | null = null;

  constructor() {
    effect(() => {
      const p = this.prestacion();
      const d = this.dialogo().nativeElement;
      if (p && p.id !== this.abierta) this.reiniciar(p);
      this.abierta = p?.id ?? null;
      if (p && !d.open) d.showModal();
      if (!p && d.open) d.close();
    });
  }

  protected cerrar(): void {
    this.prestacion.set(null);
  }

  protected async registrarPago(p: Prestacion): Promise<void> {
    await this.hacer(() =>
      this.api.pagar(p.id, {
        medio: this.pago.medio,
        monto: this.pago.monto ?? undefined,
        fecha: this.pago.fecha || undefined,
      }),
    );
    this.pago.monto = null;
  }

  protected rechazarPago(id: string) {
    return this.hacer(() => this.api.actualizarPago(id, { estado: 'rechazado' }));
  }

  protected borrarPago(id: string) {
    return this.hacer(() => this.api.borrarPago(id));
  }

  protected guardarToken(p: Prestacion) {
    return this.hacer(() => this.api.actualizar(p.id, { token: this.token.trim() || null }));
  }

  protected alternarFacturada(p: Prestacion) {
    return this.hacer(() => this.api.actualizar(p.id, { facturada: !p.facturada }));
  }

  protected async guardarMonto(p: Prestacion, automatico = false): Promise<void> {
    const monto = automatico ? null : this.montoManual;
    if (!automatico && (monto === null || monto < 0)) return;
    await this.hacer(() => this.api.actualizar(p.id, { monto }));
    this.montoManual = this.prestacion()?.monto ?? null;
  }

  private reiniciar(p: Prestacion): void {
    this.error.set(null);
    this.pago = { medio: p.financiador ? 'transferencia' : 'efectivo', monto: null, fecha: '' };
    this.token = p.token ?? '';
    this.montoManual = p.monto;
  }

  private async hacer(op: () => Promise<Prestacion>): Promise<void> {
    this.ocupado.set(true);
    this.error.set(null);
    try {
      const p = await op();
      this.prestacion.set(p);
      this.cambio.emit(p);
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.ocupado.set(false);
    }
  }
}

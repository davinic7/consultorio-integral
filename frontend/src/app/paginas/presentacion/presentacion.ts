import { Component, computed, effect, inject, OnInit, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CobrosApi, FinanciadoresApi, mensajeDeError, PresentacionApi } from '../../core/api/api';
import type {
  Financiador,
  Presentacion as DatosPresentacion,
  ResultadoToken,
  SesionPresentacion,
} from '../../core/api/modelos';
import { AuthService } from '../../core/auth/auth.service';
import { nombreMes, sumarMes } from '../../core/cobros';
import { ahoraEn } from '../../core/fechas';

const ESTADO_TOKEN: Record<ResultadoToken['estado'], string> = {
  ok: 'Listo',
  duplicado: 'Repetido',
  sin_paciente: 'No se encontró al paciente',
  sin_sesion: 'No quedan sesiones sin token',
  invalido: 'Token inválido',
};

/**
 * Presentación mensual a una obra social (portado de osep.php, orden.php y
 * tokens.php): por paciente, cada sesión con la fecha a declarar (sugerida por
 * las reglas), la orden, el token y si ya se presentó.
 */
@Component({
  selector: 'app-presentacion',
  imports: [FormsModule, RouterLink],
  templateUrl: './presentacion.html',
  styles: `
    .cabecera,
    .fila {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .controles {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem;
    }
    .mes {
      min-width: 9.5rem;
      text-align: center;
      font-weight: 600;
    }
    .paciente {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .nota {
      font-size: 0.75rem;
    }
    .aviso {
      color: var(--oc-aviso-texto);
      font-size: 0.75rem;
    }
    input[type='date'],
    input.token {
      min-height: 2.25rem;
      padding: 0 0.5rem;
      border: 1px solid var(--oc-borde);
      border-radius: var(--oc-radio-chico);
      background: var(--oc-campo);
      color: var(--oc-texto);
      font: inherit;
    }
    input.token {
      width: 8rem;
      font-family: var(--oc-fuente-mono);
      text-transform: uppercase;
    }
    textarea {
      width: 100%;
      min-height: 8rem;
      font-family: var(--oc-fuente-mono);
    }
  `,
})
export class Presentacion implements OnInit {
  private readonly api = inject(PresentacionApi);
  private readonly cobros = inject(CobrosApi);
  private readonly financiadoresApi = inject(FinanciadoresApi);
  private readonly auth = inject(AuthService);

  protected readonly mes = signal(
    ahoraEn(this.auth.sesion()?.centro?.zonaHoraria).fecha.slice(0, 7),
  );
  protected readonly financiadores = signal<Financiador[]>([]);
  protected readonly financiadorId = signal<string>('');
  protected readonly datos = signal<DatosPresentacion | null>(null);
  protected readonly ocupado = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly mensaje = signal<string | null>(null);
  protected readonly verTokens = signal(false);
  protected readonly resultadoTokens = signal<ResultadoToken[] | null>(null);
  protected textoTokens = '';

  protected readonly estadoToken = ESTADO_TOKEN;
  protected readonly titulo = computed(() => nombreMes(this.mes()));
  protected readonly dmy = (f: string | null) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '—');
  protected readonly tokensListos = computed(
    () => (this.resultadoTokens() ?? []).filter((r) => r.estado === 'ok').length,
  );

  constructor() {
    effect(() => {
      const mes = this.mes();
      const id = this.financiadorId();
      untracked(() => void this.cargar(mes, id));
    });
  }

  async ngOnInit(): Promise<void> {
    try {
      const lista = (await this.financiadoresApi.listar()).filter((f) => f.tipo !== 'particular');
      this.financiadores.set(lista);
      // Primero la que pide orden o token (como OSEP).
      const pide = (f: Financiador) => f.requiereOrden || f.requiereToken;
      const preferida =
        lista.find((f) => f.tipo === 'obra_social' && pide(f)) ?? lista.find(pide) ?? lista[0];
      if (preferida) this.financiadorId.set(preferida.id);
    } catch (e) {
      this.error.set(mensajeDeError(e));
    }
  }

  protected moverMes(n: number): void {
    this.mes.update((m) => sumarMes(m, n));
    this.resultadoTokens.set(null);
  }

  protected completarFechas() {
    return this.hacer(async () => {
      const r = await this.api.completarFechas(this.mes(), this.financiadorId());
      this.mensaje.set(
        r.asignadas
          ? `Se completaron ${r.asignadas} fechas.`
          : 'No había sesiones sin fecha para completar.',
      );
    });
  }

  protected cambiarFecha(s: SesionPresentacion, fecha: string) {
    return this.hacer(() =>
      this.cobros.actualizar(s.prestacionId, { fechaDeclarada: fecha || null }),
    );
  }

  protected guardarToken(s: SesionPresentacion, token: string) {
    if ((s.token ?? '') === token.trim().toUpperCase()) return;
    return this.hacer(() =>
      this.cobros.actualizar(s.prestacionId, { token: token.trim() || null }),
    );
  }

  protected alternarPresentada(s: SesionPresentacion) {
    return this.hacer(() => this.cobros.facturar([s.prestacionId], !s.presentada));
  }

  /** Marca presentadas todas las sesiones de un paciente que tienen fecha a declarar. */
  protected presentarPaciente(sesiones: SesionPresentacion[]) {
    const ids = sesiones
      .filter((s) => !s.presentada && s.fechaDeclarada)
      .map((s) => s.prestacionId);
    if (!ids.length) {
      this.error.set('Primero completá la fecha a declarar de las sesiones.');
      return;
    }
    return this.hacer(() => this.cobros.facturar(ids, true));
  }

  protected async probarTokens(guardar: boolean): Promise<void> {
    await this.hacer(async () => {
      const r = await this.api.tokens(this.mes(), this.financiadorId(), this.textoTokens, guardar);
      this.resultadoTokens.set(r.items);
      if (guardar) {
        this.mensaje.set(
          r.guardados === 1 ? 'Se guardó 1 token.' : `Se guardaron ${r.guardados} tokens.`,
        );
        this.textoTokens = '';
        this.resultadoTokens.set(null);
        this.verTokens.set(false);
      }
    });
  }

  private async hacer(op: () => Promise<unknown>): Promise<void> {
    this.ocupado.set(true);
    this.error.set(null);
    this.mensaje.set(null);
    try {
      await op();
    } catch (e) {
      this.error.set(mensajeDeError(e));
    } finally {
      this.ocupado.set(false);
      await this.cargar(this.mes(), this.financiadorId());
    }
  }

  private async cargar(mes: string, financiadorId: string): Promise<void> {
    if (!financiadorId) return;
    try {
      const d = await this.api.ver(mes, financiadorId);
      if (mes === this.mes() && financiadorId === this.financiadorId()) this.datos.set(d);
    } catch (e) {
      this.error.set(mensajeDeError(e, 'No se pudo cargar la presentación.'));
    }
  }
}

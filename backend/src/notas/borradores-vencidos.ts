import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Un borrador que nadie tocó en estos días se borra. */
export const DIAS_BORRADOR = 30;
const UN_DIA_MS = 24 * 60 * 60_000;

/** Instante antes del cual un borrador está vencido. */
export function limiteBorradores(ahora = new Date()): Date {
  return new Date(ahora.getTime() - DIAS_BORRADOR * UN_DIA_MS);
}

/**
 * Borra los borradores del expediente que nadie tocó en 30 días: al arrancar la API
 * y después una vez por día. Leer un borrador vencido también lo borra (NotasService).
 * Recorre los centros con el cliente de cada uno, como pide la regla de filtrar por
 * centro. En los registros va solo la cantidad.
 */
@Injectable()
export class BorradoresVencidos
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly log = new Logger('Borradores');
  private reloj?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onApplicationBootstrap(): void {
    // En los tests se llama a mano: una limpieza en paralelo a los pedidos del
    // test podría chocar con el Postgres liviano de Prisma, que no admite consultas
    // simultáneas.
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    void this.limpiarSinFallar();
    this.reloj = setInterval(() => void this.limpiarSinFallar(), UN_DIA_MS);
    this.reloj.unref();
  }

  onModuleDestroy(): void {
    clearInterval(this.reloj);
  }

  /** Devuelve cuántos borró. */
  async limpiar(ahora = new Date()): Promise<number> {
    const limite = limiteBorradores(ahora);
    const centros = await this.prisma.centro.findMany({ select: { id: true } });
    let total = 0;
    for (const centro of centros) {
      const { count } = await this.prisma
        .paraCentro(centro.id)
        .borradorNota.deleteMany({ where: { actualizadoEn: { lt: limite } } });
      total += count;
    }
    if (total) this.log.log(`borradores vencidos borrados: ${total}`);
    return total;
  }

  private async limpiarSinFallar(): Promise<void> {
    try {
      await this.limpiar();
    } catch {
      this.log.warn('no se pudieron borrar los borradores vencidos');
    }
  }
}

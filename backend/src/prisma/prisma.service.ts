import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { clienteDeCentro, type ClienteDeCentro } from './centro.js';

/**
 * Cliente de Prisma compartido. Conecta a PostgreSQL de forma perezosa
 * (en la primera consulta), así la API levanta aunque la base no esté lista.
 *
 * Para datos de un centro usar siempre paraCentro(centroId), nunca el cliente directo.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<Env, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: config.get('DATABASE_URL', { infer: true }),
      }),
    });
  }

  /** Cliente limitado a un centro (ver centro.ts). */
  paraCentro(centroId: string): ClienteDeCentro {
    return clienteDeCentro(this, centroId);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

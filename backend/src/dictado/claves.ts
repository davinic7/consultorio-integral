import { Injectable } from '@nestjs/common';
import type { JsonWebKey } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { CifradoService } from '../notas/cifrado.js';
import { sinCentro } from '../prisma/centro.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { generarPar } from './paquete.js';

export interface ClavePublica {
  version: number;
  clave: JsonWebKey;
}

/** Contexto del cifrado de la privada: atada a la persona y a la versión. */
const contexto = (usuarioId: string, version: number) =>
  `clave-dictado:${usuarioId}:${version}`;

/**
 * Pares de claves del dictado, uno vigente por persona y centro, con versión
 * (decisiones.md §20). Se generan al azar; la privada se guarda cifrada con la
 * clave de datos del centro y nunca sale del servidor.
 */
@Injectable()
export class ClavesDictado {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cifrado: CifradoService,
  ) {}

  /** La pública vigente; la primera vez se crea el par. */
  async vigente(centroId: string, usuarioId: string): Promise<ClavePublica> {
    const actual = await this.prisma
      .paraCentro(centroId)
      .claveDictado.findFirst({ where: { usuarioId, vigente: true } });
    if (actual)
      return { version: actual.version, clave: JSON.parse(actual.publica) };
    return this.crear(centroId, usuarioId);
  }

  /**
   * Par nuevo (por ejemplo, si se perdió el teléfono). Los anteriores dejan de
   * entregarse pero se conservan para abrir lo que quedó pendiente.
   */
  renovar(centroId: string, usuarioId: string): Promise<ClavePublica> {
    return this.crear(centroId, usuarioId);
  }

  /** La privada de una versión (PKCS#8 en base64), o null si no existe. */
  async privada(
    centroId: string,
    usuarioId: string,
    version: number,
  ): Promise<string | null> {
    const c = await this.prisma.paraCentro(centroId).claveDictado.findUnique({
      where: {
        centroId_usuarioId_version: { centroId, usuarioId, version },
      },
    });
    if (!c) return null;
    return this.cifrado.descifrarDato(
      centroId,
      c.privada,
      contexto(usuarioId, version),
    );
  }

  private async crear(
    centroId: string,
    usuarioId: string,
  ): Promise<ClavePublica> {
    const db = this.prisma.paraCentro(centroId);
    const ultima = await db.claveDictado.findFirst({
      where: { usuarioId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (ultima?.version ?? 0) + 1;
    const par = generarPar();
    const privada = await this.cifrado.cifrarDato(
      centroId,
      par.privada,
      contexto(usuarioId, version),
    );
    try {
      await db.$transaction([
        db.claveDictado.updateMany({
          where: { usuarioId, vigente: true },
          data: { vigente: false },
        }),
        db.claveDictado.create({
          data: sinCentro<Prisma.ClaveDictadoUncheckedCreateInput>({
            usuarioId,
            version,
            publica: JSON.stringify(par.publica),
            privada,
          }),
        }),
      ]);
    } catch (e) {
      // Dos pedidos a la vez crearon la misma versión: queda la que ganó.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        const actual = await db.claveDictado.findFirst({
          where: { usuarioId, vigente: true },
        });
        if (actual) {
          return { version: actual.version, clave: JSON.parse(actual.publica) };
        }
      }
      throw e;
    }
    return { version, clave: par.publica };
  }
}

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import type { Env } from '../config/env.js';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Cifrado de notas clínicas con AES-256-GCM (portado de referencia-php/app/lib/crypto.php).
 *
 * Dos niveles de clave:
 * - Clave maestra (DATOS_CLAVE_MAESTRA, fuera de la base): solo protege las claves de datos.
 * - Clave de datos de cada centro (32 bytes al azar), guardada cifrada en centros.clave_datos.
 *
 * Un volcado de la base no alcanza para leer las notas. Cada texto se cifra con
 * "datos adicionales" (centro, paciente y autor): si alguien mueve el texto
 * cifrado a otra fila, no se puede descifrar.
 *
 * Formato guardado: "v1:" + base64(iv[12] + tag[16] + texto cifrado).
 */

const VERSION = 'v1:';

export function cifrarAes(texto: Buffer, clave: Buffer, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const cifrado = Buffer.concat([c.update(texto), c.final()]);
  return (
    VERSION + Buffer.concat([iv, c.getAuthTag(), cifrado]).toString('base64')
  );
}

/** Devuelve null si el dato fue alterado o la clave no corresponde. */
export function descifrarAes(
  dato: string,
  clave: Buffer,
  aad: string,
): Buffer | null {
  if (!dato.startsWith(VERSION)) return null;
  const b = Buffer.from(dato.slice(VERSION.length), 'base64');
  if (b.length < 28) return null;
  try {
    const d = createDecipheriv('aes-256-gcm', clave, b.subarray(0, 12));
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]);
  } catch {
    return null;
  }
}

/** Clave de 32 bytes derivada del texto de DATOS_CLAVE_MAESTRA (acepta cualquier formato). */
export function claveMaestra(texto: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      Buffer.from(texto, 'utf8'),
      Buffer.alloc(0),
      'centro-integral/clave-maestra/v1',
      32,
    ),
  );
}

/** Qué ata una nota a su fila: si cambia alguno, no se descifra. */
export interface ContextoNota {
  centroId: string;
  pacienteId: string;
  profesionalId: string;
}

const aadNota = (c: ContextoNota) =>
  `nota:${c.centroId}:${c.pacienteId}:${c.profesionalId}`;
const aadClave = (centroId: string) => `clave-centro:${centroId}`;

export const TEXTO_ILEGIBLE =
  '[No se pudo descifrar la nota: revisar DATOS_CLAVE_MAESTRA]';

@Injectable()
export class CifradoService {
  private readonly maestra: Buffer;
  private readonly cache = new Map<string, Buffer>();

  constructor(
    config: ConfigService<Env, true>,
    private readonly prisma: PrismaService,
  ) {
    this.maestra = claveMaestra(
      config.get('DATOS_CLAVE_MAESTRA', { infer: true }),
    );
  }

  async cifrarNota(texto: string, ctx: ContextoNota): Promise<string> {
    const clave = await this.claveDeCentro(ctx.centroId);
    return cifrarAes(Buffer.from(texto, 'utf8'), clave, aadNota(ctx));
  }

  async descifrarNota(dato: string, ctx: ContextoNota): Promise<string> {
    const clave = await this.claveDeCentro(ctx.centroId);
    return (
      descifrarAes(dato, clave, aadNota(ctx))?.toString('utf8') ??
      TEXTO_ILEGIBLE
    );
  }

  /** Clave de datos del centro; la crea la primera vez. */
  private async claveDeCentro(centroId: string): Promise<Buffer> {
    const enCache = this.cache.get(centroId);
    if (enCache) return enCache;

    let centro = await this.prisma.centro.findUniqueOrThrow({
      where: { id: centroId },
      select: { claveDatos: true },
    });
    if (!centro.claveDatos) {
      const nueva = cifrarAes(randomBytes(32), this.maestra, aadClave(centroId));
      // Solo se guarda si sigue vacía: si dos pedidos llegan a la vez, gana uno.
      await this.prisma.centro.updateMany({
        where: { id: centroId, claveDatos: null },
        data: { claveDatos: nueva },
      });
      centro = await this.prisma.centro.findUniqueOrThrow({
        where: { id: centroId },
        select: { claveDatos: true },
      });
    }
    const clave = descifrarAes(
      centro.claveDatos!,
      this.maestra,
      aadClave(centroId),
    );
    if (!clave || clave.length !== 32) {
      throw new Error(
        'No se pudo abrir la clave de datos del centro: DATOS_CLAVE_MAESTRA no es la misma con la que se creó',
      );
    }
    this.cache.set(centroId, clave);
    return clave;
  }
}

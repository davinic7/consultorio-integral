import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../generated/prisma/client.js';
import { ErrorAislamientoCentro } from '../prisma/centro.js';

/**
 * Traduce errores conocidos de Prisma a respuestas HTTP claras, para no
 * repetir try/catch en cada servicio:
 *   P2002 (único repetido) → 409, P2025 (no encontrado) → 404,
 *   P2003 (referencia inválida o en uso) → 409, intento de cruzar centros → 403.
 */
@Catch(Prisma.PrismaClientKnownRequestError, ErrorAislamientoCentro)
export class PrismaErroresFilter implements ExceptionFilter {
  catch(
    error: Prisma.PrismaClientKnownRequestError | ErrorAislamientoCentro,
    host: ArgumentsHost,
  ) {
    const res = host.switchToHttp().getResponse<Response>();
    const [status, message] = traducir(error);
    res.status(status).json({ statusCode: status, message });
  }
}

function traducir(
  error: Prisma.PrismaClientKnownRequestError | ErrorAislamientoCentro,
): [number, string] {
  if (error instanceof ErrorAislamientoCentro) {
    return [HttpStatus.FORBIDDEN, 'No tenés acceso a ese recurso'];
  }
  switch (error.code) {
    case 'P2002':
      return [
        HttpStatus.CONFLICT,
        `Ya existe un registro con ese ${campos(error)}`,
      ];
    case 'P2025':
      return [HttpStatus.NOT_FOUND, 'No encontrado'];
    case 'P2003':
      return [
        HttpStatus.CONFLICT,
        'Referencia inválida o el registro está en uso',
      ];
    default:
      return [HttpStatus.INTERNAL_SERVER_ERROR, 'Error interno'];
  }
}

interface MetaUnico {
  target?: string[] | string;
  driverAdapterError?: {
    cause?: {
      table?: string;
      constraint?: { fields?: string[]; index?: string };
    };
  };
}

/**
 * Nombre legible de los campos que chocaron en un índice único. Con el adapter
 * de PostgreSQL, Prisma solo informa el índice (ej. "salas_centro_id_nombre_key"),
 * así que se deduce de su nombre; centro_id no se muestra.
 */
export function campos(error: Prisma.PrismaClientKnownRequestError): string {
  const meta = error.meta as MetaUnico | undefined;
  const causa = meta?.driverAdapterError?.cause;
  let lista: string[] =
    causa?.constraint?.fields ??
    (Array.isArray(meta?.target)
      ? meta.target
      : meta?.target
        ? [meta.target]
        : []);
  const indice = causa?.constraint?.index;
  if (
    !lista.length &&
    indice &&
    causa?.table &&
    indice.startsWith(`${causa.table}_`)
  ) {
    lista = [
      indice
        .slice(causa.table.length + 1)
        .replace(/_key$/, '')
        .replace(/^centro_id_?/, ''),
    ];
  }
  const visibles = lista
    .map((c) => c.replaceAll('"', ''))
    .filter((c) => c && c !== 'centro_id' && c !== 'centroId');
  return visibles.length ? visibles.join(', ') : 'valor';
}

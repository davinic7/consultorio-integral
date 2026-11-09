import { Prisma, PrismaClient } from '../generated/prisma/client.js';

/**
 * Modelos con datos de un centro (tienen centro_id). Un test verifica que esta
 * lista coincida con el schema, así un modelo nuevo no queda sin filtrar.
 */
export const MODELOS_DE_CENTRO: ReadonlySet<Prisma.ModelName> =
  new Set<Prisma.ModelName>([
    'Miembro',
    'Profesional',
    'Sala',
    'Financiador',
    'Paciente',
    'PacienteProfesional',
    'Recurrencia',
    'Turno',
    'Prestacion',
    'Pago',
    'Liquidacion',
    'NotaSesion',
    'Aviso',
    'CambioAsistencia',
  ]);

/** Intento de leer o escribir datos de otro centro. */
export class ErrorAislamientoCentro extends Error {
  constructor(detalle: string) {
    super(`Aislamiento entre centros: ${detalle}`);
    this.name = 'ErrorAislamientoCentro';
  }
}

type Args = Record<string, any>;

const OPERACIONES_CON_WHERE = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

const OPERACIONES_CON_DATA_ARRAY = new Set([
  'createMany',
  'createManyAndReturn',
]);

function conCentroEnWhere(where: Args | undefined, centroId: string): Args {
  if (where?.centroId !== undefined && where.centroId !== centroId) {
    throw new ErrorAislamientoCentro('el filtro pide otro centro_id');
  }
  return { ...where, centroId };
}

function conCentroEnData(data: Args, centroId: string): Args {
  if (data.centro !== undefined) {
    throw new ErrorAislamientoCentro(
      'no usar la relación "centro" en escrituras; el centro lo pone el cliente',
    );
  }
  if (data.centroId !== undefined && data.centroId !== centroId) {
    throw new ErrorAislamientoCentro('se intentó escribir otro centro_id');
  }
  return { ...data, centroId };
}

function sinCambioDeCentro(
  data: Args | undefined,
  centroId: string,
): Args | undefined {
  if (
    data?.centro !== undefined ||
    (data?.centroId !== undefined && data.centroId !== centroId)
  ) {
    throw new ErrorAislamientoCentro(
      'no se puede mover un registro a otro centro',
    );
  }
  return data;
}

/**
 * Agrega el centro a los argumentos de una operación de Prisma.
 * Función pura (sin base) para poder testearla aparte.
 */
export function aplicarCentro(
  operacion: string,
  args: Args | undefined,
  centroId: string,
): Args {
  const a: Args = { ...args };

  if (OPERACIONES_CON_WHERE.has(operacion)) {
    a.where = conCentroEnWhere(a.where, centroId);
  }

  switch (operacion) {
    case 'create':
      a.data = conCentroEnData(a.data ?? {}, centroId);
      break;
    case 'update':
    case 'updateMany':
    case 'updateManyAndReturn':
      a.data = sinCambioDeCentro(a.data, centroId);
      break;
    case 'upsert':
      a.create = conCentroEnData(a.create ?? {}, centroId);
      a.update = sinCambioDeCentro(a.update, centroId);
      break;
    default:
      if (OPERACIONES_CON_DATA_ARRAY.has(operacion)) {
        const filas = Array.isArray(a.data) ? a.data : [a.data];
        a.data = filas.map((fila: Args) => conCentroEnData(fila, centroId));
      }
  }
  return a;
}

/**
 * Cliente de Prisma limitado a un centro: toda consulta sobre un modelo de
 * centro filtra por centroId y toda alta lo completa. Equivale a q() + pf()
 * de la referencia PHP. Las relaciones anidadas quedan cubiertas por las
 * claves foráneas compuestas (centro_id, id) de la base.
 *
 * Las consultas SQL crudas ($queryRaw, $executeRaw) no pasan por acá: deben
 * filtrar por centro_id a mano.
 */
export function clienteDeCentro(prisma: PrismaClient, centroId: string) {
  if (!centroId) throw new ErrorAislamientoCentro('falta centroId');
  return prisma.$extends({
    name: 'centro',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!MODELOS_DE_CENTRO.has(model as Prisma.ModelName))
            return query(args);
          return query(
            aplicarCentro(operation, args as Args, centroId) as typeof args,
          );
        },
      },
    },
  });
}

export type ClienteDeCentro = ReturnType<typeof clienteDeCentro>;

/**
 * Datos para crear un registro con el cliente de centro, sin centroId (lo
 * completa la extensión). Evita castear a any y sigue chequeando el resto:
 *
 *   db.sala.create({ data: sinCentro<Prisma.SalaUncheckedCreateInput>({ nombre }) })
 */
export function sinCentro<T extends { centroId: string }>(
  datos: Omit<T, 'centroId'>,
): T {
  return datos as T;
}

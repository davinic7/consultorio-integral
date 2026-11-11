import { Modulo } from '../src/generated/prisma/client.js';

/** Para crear un plan de prueba con todos los módulos habilitados. */
export const TODOS_LOS_MODULOS = {
  create: Object.values(Modulo).map((modulo) => ({ modulo })),
};

import {
  randomBytes,
  scrypt,
  timingSafeEqual,
  type ScryptOptions,
} from 'node:crypto';

/**
 * Hash de contraseñas con scrypt (incluido en Node, sin dependencias nativas).
 * Formato: scrypt$N$r$p$salt$hash (base64url). Los parámetros viajan en el hash,
 * así se pueden endurecer más adelante sin invalidar los existentes.
 */
const N = 2 ** 15;
const R = 8;
const P = 1;
const LARGO = 64;
const MAXMEM = 64 * 1024 * 1024;

function derivar(
  password: string,
  salt: Buffer,
  opts: ScryptOptions,
  largo: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      salt,
      largo,
      { ...opts, maxmem: MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derivar(password, salt, { N, r: R, p: P }, LARGO);
  return [
    'scrypt',
    N,
    R,
    P,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

export async function verificarPassword(
  password: string,
  guardado: string,
): Promise<boolean> {
  const partes = guardado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = partes;
  const esperado = Buffer.from(hashB64, 'base64url');
  const calculado = await derivar(
    password,
    Buffer.from(saltB64, 'base64url'),
    { N: Number(n), r: Number(r), p: Number(p) },
    esperado.length,
  );
  return (
    calculado.length === esperado.length && timingSafeEqual(calculado, esperado)
  );
}

let senuelo: Promise<string> | undefined;

/** Hash válido de una contraseña al azar: para gastar el mismo tiempo cuando el email no existe. */
export function hashSenuelo(): Promise<string> {
  senuelo ??= hashPassword(randomBytes(16).toString('hex'));
  return senuelo;
}

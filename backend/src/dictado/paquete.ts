import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  type JsonWebKey,
} from 'node:crypto';

/**
 * Grabación cifrada para el servidor (decisiones.md §20). El navegador la arma con
 * WebCrypto y solo el servidor la puede abrir:
 *
 * 1. Genera un par ECDH P-256 de un solo uso y lo combina con la clave pública del
 *    usuario: el secreto compartido pasa por HKDF-SHA256 y da una clave AES-256.
 * 2. Cifra el WAV con AES-GCM. Los datos adicionales atan el paquete al centro, a
 *    la persona y al paciente: no se puede presentar para otro paciente.
 *
 * Formato: "CIDA" | formato (1 byte) | versión de la clave (uint32 BE)
 *          | pública de un solo uso (65 bytes, sin comprimir) | iv (12) | cifrado + tag (16).
 */

export const MARCA = 'CIDA';
export const FORMATO = 1;
export const INFO_HKDF = 'centro-integral/dictado/v1';
const LARGO_PUBLICA = 65;
const LARGO_IV = 12;
const LARGO_TAG = 16;
export const CABECERA_PAQUETE = 4 + 1 + 4 + LARGO_PUBLICA + LARGO_IV;
/** Lo que el paquete suma al WAV. */
export const EXTRA_PAQUETE = CABECERA_PAQUETE + LARGO_TAG;

/** Paquete que no se puede abrir. El mensaje se puede mostrar: no tiene datos de nadie. */
export class ErrorPaquete extends Error {}

export interface Paquete {
  versionClave: number;
  publicaUnUso: Buffer;
  iv: Buffer;
  /** Texto cifrado con el tag de 16 bytes al final (como lo devuelve WebCrypto). */
  cifrado: Buffer;
}

export interface ParDeClaves {
  publica: JsonWebKey;
  /** PKCS#8 en base64. */
  privada: string;
}

export function generarPar(): ParDeClaves {
  const { publicKey, privateKey } = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  const jwk = publicKey.export({ format: 'jwk' });
  return {
    publica: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    privada: privateKey
      .export({ format: 'der', type: 'pkcs8' })
      .toString('base64'),
  };
}

/** Qué ata el paquete: si cambia alguno, no se abre. */
export function datosAdicionales(c: {
  centroId: string;
  usuarioId: string;
  pacienteId: string;
}): string {
  return `dictado:${c.centroId}:${c.usuarioId}:${c.pacienteId}`;
}

export function leerPaquete(bytes: Uint8Array): Paquete {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.length < EXTRA_PAQUETE + 1)
    throw new ErrorPaquete('La grabación está vacía');
  if (b.subarray(0, 4).toString('latin1') !== MARCA || b[4] !== FORMATO) {
    throw new ErrorPaquete('La grabación no tiene el formato esperado');
  }
  let pos = 5;
  const versionClave = b.readUInt32BE(pos);
  pos += 4;
  const publicaUnUso = b.subarray(pos, pos + LARGO_PUBLICA);
  pos += LARGO_PUBLICA;
  if (publicaUnUso[0] !== 0x04) {
    throw new ErrorPaquete('La grabación no tiene el formato esperado');
  }
  const iv = b.subarray(pos, pos + LARGO_IV);
  pos += LARGO_IV;
  return { versionClave, publicaUnUso, iv, cifrado: b.subarray(pos) };
}

/** Abre el paquete con la privada del usuario. Falla si se alteró o no le corresponde. */
export function abrirPaquete(
  p: Paquete,
  privadaPkcs8: string,
  aad: string,
): Uint8Array {
  try {
    const privada = createPrivateKey({
      key: Buffer.from(privadaPkcs8, 'base64'),
      format: 'der',
      type: 'pkcs8',
    });
    const unUso = createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: p.publicaUnUso.subarray(1, 33).toString('base64url'),
        y: p.publicaUnUso.subarray(33, 65).toString('base64url'),
      },
      format: 'jwk',
    });
    const secreto = diffieHellman({ privateKey: privada, publicKey: unUso });
    const clave = Buffer.from(
      hkdfSync('sha256', secreto, p.publicaUnUso, INFO_HKDF, 32),
    );
    const d = createDecipheriv('aes-256-gcm', clave, p.iv);
    d.setAAD(Buffer.from(aad, 'utf8'));
    d.setAuthTag(p.cifrado.subarray(p.cifrado.length - LARGO_TAG));
    return Buffer.concat([
      d.update(p.cifrado.subarray(0, p.cifrado.length - LARGO_TAG)),
      d.final(),
    ]);
  } catch {
    throw new ErrorPaquete('No se pudo abrir la grabación');
  }
}

/**
 * Cifra cada grabación para el servidor (docs/decisiones.md §20), solo con WebCrypto:
 * ECDH P-256 de un solo uso con la clave pública de la persona → HKDF-SHA256 →
 * AES-256-GCM. Ni este teléfono ni quien lo tenga puede abrirla: la privada nunca
 * sale del servidor. Mismo formato que backend/src/dictado/paquete.ts.
 *
 * "CIDA" | formato (1) | versión de la clave (uint32) | pública de un solo uso (65) | iv (12) | cifrado + tag
 */

const MARCA = 'CIDA';
const FORMATO = 1;
const INFO_HKDF = 'centro-integral/dictado/v1';

/** Qué ata la grabación: el servidor no la abre para otro centro, persona o paciente. */
export function datosAdicionales(c: {
  centroId: string;
  usuarioId: string;
  pacienteId: string;
}): string {
  return `dictado:${c.centroId}:${c.usuarioId}:${c.pacienteId}`;
}

export async function cifrarParaServidor(
  wav: Uint8Array<ArrayBuffer>,
  publica: JsonWebKey,
  versionClave: number,
  aad: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const subtle = crypto.subtle;
  const servidor = await subtle.importKey(
    'jwk',
    publica,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const unUso = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ]);
  const secreto = await subtle.deriveBits(
    { name: 'ECDH', public: servidor },
    unUso.privateKey,
    256,
  );
  const publicaUnUso = new Uint8Array(await subtle.exportKey('raw', unUso.publicKey));
  const base = await subtle.importKey('raw', secreto, 'HKDF', false, ['deriveKey']);
  const clave = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: publicaUnUso,
      info: new TextEncoder().encode(INFO_HKDF),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(
    await subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
      clave,
      wav,
    ),
  );
  const paquete = new Uint8Array(new ArrayBuffer(4 + 1 + 4 + 65 + 12 + cifrado.length));
  paquete.set(new TextEncoder().encode(MARCA), 0);
  paquete[4] = FORMATO;
  new DataView(paquete.buffer).setUint32(5, versionClave);
  paquete.set(publicaUnUso, 9);
  paquete.set(iv, 74);
  paquete.set(cifrado, 86);
  return paquete;
}

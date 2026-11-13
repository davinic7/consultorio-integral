/**
 * Arma una grabación cifrada como lo hace el navegador (frontend/src/app/core/dictado/
 * cifrado.ts), con WebCrypto: ECDH P-256 de un solo uso + HKDF-SHA256 + AES-256-GCM.
 * Para probar que el servidor la abre y que rechaza las alteradas.
 */
import type { webcrypto } from 'node:crypto';

export type ClaveJwk = webcrypto.JsonWebKey;

const MARCA = 'CIDA';
const FORMATO = 1;
const INFO_HKDF = 'centro-integral/dictado/v1';

export async function cifrarComoElNavegador(
  wav: Uint8Array,
  publica: ClaveJwk,
  versionClave: number,
  aad: string,
): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const servidor = await subtle.importKey(
    'jwk',
    publica,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const unUso = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const secreto = await subtle.deriveBits(
    { name: 'ECDH', public: servidor },
    unUso.privateKey,
    256,
  );
  const publicaUnUso = new Uint8Array(
    await subtle.exportKey('raw', unUso.publicKey),
  );
  const base = await subtle.importKey('raw', secreto, 'HKDF', false, [
    'deriveKey',
  ]);
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
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const cifrado = new Uint8Array(
    await subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: new TextEncoder().encode(aad),
      },
      clave,
      wav,
    ),
  );
  const paquete = new Uint8Array(4 + 1 + 4 + 65 + 12 + cifrado.length);
  const vista = new DataView(paquete.buffer);
  paquete.set(new TextEncoder().encode(MARCA), 0);
  paquete[4] = FORMATO;
  vista.setUint32(5, versionClave);
  paquete.set(publicaUnUso, 9);
  paquete.set(iv, 74);
  paquete.set(cifrado, 86);
  return paquete;
}

/** WAV PCM 16 bits mono 16 kHz de `segundos` de un tono suave (sin datos de nadie). */
export function wavDePrueba(segundos: number): Uint8Array {
  const n = Math.round(segundos * 16_000);
  const bytes = new Uint8Array(44 + n * 2);
  const v = new DataView(bytes.buffer);
  const texto = (desde: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(desde + i, s.charCodeAt(i));
  };
  texto(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  texto(8, 'WAVE');
  texto(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 16_000, true);
  v.setUint32(28, 32_000, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  texto(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    v.setInt16(
      44 + i * 2,
      Math.round(3000 * Math.sin((i / 16_000) * 2 * Math.PI * 220)),
      true,
    );
  }
  return bytes;
}

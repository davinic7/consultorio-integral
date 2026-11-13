import { cifrarParaServidor, datosAdicionales } from './cifrado';

const subtle = globalThis.crypto?.subtle;
const AAD = datosAdicionales({ centroId: 'c1', usuarioId: 'u1', pacienteId: 'p1' });

/** Abre el paquete como lo hace el servidor (backend/src/dictado/paquete.ts), con WebCrypto. */
async function abrirComoElServidor(paquete: Uint8Array, privada: CryptoKey, aad: string) {
  const unUso = await subtle.importKey(
    'raw',
    paquete.slice(9, 74),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const secreto = await subtle.deriveBits({ name: 'ECDH', public: unUso }, privada, 256);
  const base = await subtle.importKey('raw', secreto, 'HKDF', false, ['deriveKey']);
  const clave = await subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: paquete.slice(9, 74),
      info: new TextEncoder().encode('centro-integral/dictado/v1'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  return new Uint8Array(
    await subtle.decrypt(
      { name: 'AES-GCM', iv: paquete.slice(74, 86), additionalData: new TextEncoder().encode(aad) },
      clave,
      paquete.slice(86),
    ),
  );
}

describe.skipIf(!subtle)('cifrado de la grabación', () => {
  it('arma el paquete con la versión de la clave y solo lo abre la privada', async () => {
    const servidor = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const publica = await subtle.exportKey('jwk', servidor.publicKey);
    const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4, 5]);
    const paquete = await cifrarParaServidor(wav, publica, 7, AAD);

    expect(String.fromCharCode(...paquete.slice(0, 4))).toBe('CIDA');
    expect(paquete[4]).toBe(1);
    expect(new DataView(paquete.buffer).getUint32(5)).toBe(7);
    expect(paquete[9]).toBe(0x04); // pública de un solo uso, sin comprimir
    expect(await abrirComoElServidor(paquete, servidor.privateKey, AAD)).toEqual(wav);
  });

  it('no se abre para otro paciente ni con otra clave', async () => {
    const servidor = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const otra = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ]);
    const paquete = await cifrarParaServidor(
      new Uint8Array([1, 2, 3]),
      await subtle.exportKey('jwk', servidor.publicKey),
      1,
      AAD,
    );
    const otroPaciente = datosAdicionales({ centroId: 'c1', usuarioId: 'u1', pacienteId: 'p2' });
    await expect(abrirComoElServidor(paquete, servidor.privateKey, otroPaciente)).rejects.toThrow();
    await expect(abrirComoElServidor(paquete, otra.privateKey, AAD)).rejects.toThrow();
  });
});

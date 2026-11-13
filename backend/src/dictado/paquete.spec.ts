import {
  cifrarComoElNavegador,
  wavDePrueba,
} from '../../test/dictado-navegador.js';
import {
  abrirPaquete,
  datosAdicionales,
  ErrorPaquete,
  generarPar,
  leerPaquete,
} from './paquete.js';

const CTX = { centroId: 'c1', usuarioId: 'u1', pacienteId: 'p1' };

describe('paquete cifrado del dictado', () => {
  it('el servidor abre lo que cifró el navegador con la clave pública', async () => {
    const par = generarPar();
    const wav = wavDePrueba(0.5);
    const paquete = await cifrarComoElNavegador(
      wav,
      par.publica,
      3,
      datosAdicionales(CTX),
    );
    const leido = leerPaquete(paquete);
    expect(leido.versionClave).toBe(3);
    expect(
      Buffer.from(abrirPaquete(leido, par.privada, datosAdicionales(CTX))),
    ).toEqual(Buffer.from(wav));
  });

  it('no se abre para otro paciente, con otra clave ni alterado', async () => {
    const par = generarPar();
    const paquete = await cifrarComoElNavegador(
      wavDePrueba(0.5),
      par.publica,
      1,
      datosAdicionales(CTX),
    );
    expect(() =>
      abrirPaquete(
        leerPaquete(paquete),
        par.privada,
        datosAdicionales({ ...CTX, pacienteId: 'p2' }),
      ),
    ).toThrow(ErrorPaquete);
    expect(() =>
      abrirPaquete(
        leerPaquete(paquete),
        generarPar().privada,
        datosAdicionales(CTX),
      ),
    ).toThrow(ErrorPaquete);
    const alterado = paquete.slice();
    alterado[alterado.length - 20] ^= 1;
    expect(() =>
      abrirPaquete(leerPaquete(alterado), par.privada, datosAdicionales(CTX)),
    ).toThrow(ErrorPaquete);
  });

  it('rechaza lo que no tiene el formato', () => {
    expect(() => leerPaquete(new Uint8Array(10))).toThrow(ErrorPaquete);
    expect(() => leerPaquete(new Uint8Array(200))).toThrow(/formato/);
  });

  it('la clave pública no lleva la parte privada', () => {
    const { publica } = generarPar();
    expect(Object.keys(publica).sort()).toEqual(['crv', 'kty', 'x', 'y']);
  });
});

import { generateKeyPairSync } from 'node:crypto';
import forge from 'node-forge';
import {
  armarTra,
  ClienteArca,
  etiqueta,
  firmarTra,
  generarCsr,
  leerCertificado,
  urlQr,
  type Transporte,
} from './arca.js';

/** Certificado autofirmado para probar (ARCA da uno firmado por su CA). */
function certificadoDePrueba() {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const clave = forge.pki.privateKeyFromPem(
    privateKey,
  ) as forge.pki.rsa.PrivateKey;
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.setRsaPublicKey(clave.n, clave.e);
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date('2026-01-01T00:00:00Z');
  cert.validity.notAfter = new Date('2028-01-01T00:00:00Z');
  cert.setSubject([{ name: 'commonName', value: 'prueba' }]);
  cert.setIssuer([{ name: 'commonName', value: 'prueba' }]);
  cert.sign(clave, forge.md.sha256.create());
  return { certificado: forge.pki.certificateToPem(cert), clave: privateKey };
}

const respuestaWsaa = (vence: string) =>
  '<soapenv:Envelope><soapenv:Body><loginCmsResponse><loginCmsReturn>' +
  '&lt;?xml version="1.0"?&gt;&lt;loginTicketResponse&gt;&lt;header&gt;' +
  `&lt;expirationTime&gt;${vence}&lt;/expirationTime&gt;&lt;/header&gt;` +
  '&lt;credentials&gt;&lt;token&gt;TOK&lt;/token&gt;&lt;sign&gt;FIR&lt;/sign&gt;&lt;/credentials&gt;' +
  '&lt;/loginTicketResponse&gt;</loginCmsReturn></loginCmsResponse></soapenv:Body></soapenv:Envelope>';

describe('ARCA', () => {
  const { certificado, clave } = certificadoDePrueba();

  it('lee el certificado y controla que sea de la clave', () => {
    const otro = certificadoDePrueba();
    expect(leerCertificado(certificado, clave)).toEqual({
      vence: new Date('2028-01-01T00:00:00Z'),
      coincide: true,
    });
    expect(leerCertificado(certificado, otro.clave)?.coincide).toBe(false);
    expect(leerCertificado('basura')).toBeNull();
  });

  it('genera el pedido de certificado (CSR) con el CUIT', () => {
    const { clavePem, csrPem } = generarCsr('20123456789', 'Centro Demo');
    expect(clavePem).toContain('PRIVATE KEY');
    const csr = forge.pki.certificationRequestFromPem(csrPem);
    expect(csr.verify()).toBe(true);
    expect(csr.subject.getField({ type: '2.5.4.5' }).value).toBe(
      'CUIT 20123456789',
    );
  }, 30_000);

  it('firma el pedido de ticket en CMS con el contenido adentro', () => {
    const tra = armarTra(new Date('2026-11-10T12:00:00Z'));
    expect(tra).toContain(
      '<generationTime>2026-11-10T11:50:00Z</generationTime>',
    );
    const cms = firmarTra(tra, certificado, clave);
    const der = forge.util.decode64(cms);
    // No es una firma separada: el pedido va adentro.
    expect(der.includes(tra)).toBe(true);
    const p7 = forge.pkcs7.messageFromAsn1(
      forge.asn1.fromDer(der),
    ) as forge.pkcs7.PkcsSignedData;
    expect(p7.certificates).toHaveLength(1);
  });

  it('pide ticket, consulta el último número y emite la Factura C', async () => {
    const pedidos: { url: string; xml: string; accion: string }[] = [];
    const transporte: Transporte = async (url, xml, accion) => {
      pedidos.push({ url, xml, accion });
      if (url.includes('wsaa'))
        return respuestaWsaa('2099-01-01T00:00:00-03:00');
      if (accion.endsWith('FECompUltimoAutorizado'))
        return '<r><FECompUltimoAutorizadoResult><CbteNro>41</CbteNro></FECompUltimoAutorizadoResult></r>';
      return (
        '<soap:Envelope><soap:Body><FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/">' +
        '<FECAESolicitarResult><FeDetResp><FECAEDetResponse><Resultado>A</Resultado>' +
        '<CAE>76123456789012</CAE><CAEFchVto>20261120</CAEFchVto></FECAEDetResponse></FeDetResp>' +
        '</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>'
      );
    };
    const renovados: string[] = [];
    const cliente = new ClienteArca({
      modo: 'homologacion',
      cuit: '20-12345678-9',
      ptoVta: 3,
      certificado,
      clave,
      transporte,
      alRenovarTicket: async (t) => void renovados.push(t.token),
    });
    const r = await cliente.emitirFacturaC({
      dni: '30.111.222',
      total: 24000,
      fecha: '2026-11-10',
      desde: '2026-10-01',
      hasta: '2026-10-31',
      vencePago: '2026-11-10',
    });
    expect(r).toEqual({
      ok: true,
      numero: 42,
      cae: '76123456789012',
      caeVence: '2026-11-20',
      observaciones: null,
    });
    // Un solo login: el ticket se reutiliza.
    expect(pedidos.filter((p) => p.url.includes('wsaa'))).toHaveLength(1);
    expect(renovados).toEqual(['TOK']);
    const emision = pedidos.at(-1)!.xml;
    expect(pedidos.at(-1)!.url).toBe(
      'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
    );
    expect(etiqueta(emision, 'Cuit')).toBe('20123456789');
    expect(etiqueta(emision, 'CbteDesde')).toBe('42');
    expect(etiqueta(emision, 'DocTipo')).toBe('96');
    expect(etiqueta(emision, 'DocNro')).toBe('30111222');
    expect(etiqueta(emision, 'ImpTotal')).toBe('24000.00');
    expect(etiqueta(emision, 'FchServDesde')).toBe('20261001');
  });

  it('devuelve el motivo cuando ARCA rechaza', async () => {
    const transporte: Transporte = async (url, _xml, accion) => {
      if (url.includes('wsaa'))
        return respuestaWsaa('2099-01-01T00:00:00-03:00');
      if (accion.endsWith('FECompUltimoAutorizado'))
        return '<CbteNro>0</CbteNro>';
      return (
        '<FECAEDetResponse><Resultado>R</Resultado><Observaciones><Obs><Code>10015</Code>' +
        '<Msg>DocNro inválido</Msg></Obs></Observaciones></FECAEDetResponse>'
      );
    };
    const cliente = new ClienteArca({
      modo: 'produccion',
      cuit: '20123456789',
      ptoVta: 1,
      certificado,
      clave,
      transporte,
    });
    const r = await cliente.emitirFacturaC({
      dni: null,
      total: 100,
      fecha: '2026-11-10',
      desde: '2026-10-01',
      hasta: '2026-10-31',
      vencePago: '2026-11-10',
    });
    expect(r).toEqual({ ok: false, error: '10015: DocNro inválido' });
  });

  it('arma la URL del QR', () => {
    const url = urlQr({
      fecha: '2026-11-10',
      cuit: '20123456789',
      ptoVta: 3,
      numero: 42,
      total: 24000,
      docTipo: 96,
      docNro: '30111222',
      cae: '76123456789012',
    });
    const datos = JSON.parse(
      Buffer.from(url.split('?p=')[1]!, 'base64').toString('utf8'),
    );
    expect(datos).toMatchObject({
      ver: 1,
      cuit: 20123456789,
      nroCmp: 42,
      codAut: 76123456789012,
    });
  });
});

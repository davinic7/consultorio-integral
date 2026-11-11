import { request } from 'node:https';
import forge from 'node-forge';

/**
 * Factura electrónica ARCA (ex AFIP), portado de referencia-php/app/lib/Arca.php:
 * WSAA (login con certificado, ticket de 12 h) + WSFEv1 (Factura C, código 11).
 * Necesita un certificado dado de alta en ARCA, su clave privada y un punto de
 * venta del tipo "RECE para aplicativo y web services".
 */

export const URLS = {
  homologacion: {
    wsaa: 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx',
  },
  produccion: {
    wsaa: 'https://wsaa.afip.gov.ar/ws/services/LoginCms',
    wsfe: 'https://servicios1.afip.gov.ar/wsfev1/service.asmx',
  },
} as const;

export type ModoReal = keyof typeof URLS;

/** Envía un SOAP y devuelve la respuesta (se reemplaza en los tests). */
export type Transporte = (
  url: string,
  xml: string,
  soapAction: string,
) => Promise<string>;

/**
 * Transporte real. Los servidores de ARCA usan claves Diffie-Hellman cortas:
 * se baja el nivel de seguridad de TLS solo para estas conexiones (como en la referencia).
 */
export const transporteHttps: Transporte = (url, xml, soapAction) =>
  new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: `"${soapAction}"`,
        },
        ciphers: 'DEFAULT@SECLEVEL=1',
        timeout: 60_000,
      },
      (res) => {
        let cuerpo = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (cuerpo += c));
        res.on('end', () => resolve(cuerpo));
      },
    );
    req.on('timeout', () =>
      req.destroy(new Error('ARCA no respondió a tiempo')),
    );
    req.on('error', (e) =>
      reject(new Error(`No se pudo conectar con ARCA: ${e.message}`)),
    );
    req.end(xml);
  });

// ───────── XML ─────────

/** Contenido de las etiquetas con ese nombre local (sin importar el namespace). */
export function etiquetas(xml: string, nombre: string): string[] {
  const re = new RegExp(
    `<(?:[\\w-]+:)?${nombre}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${nombre}>`,
    'g',
  );
  return [...xml.matchAll(re)].map((m) => m[1]!.trim());
}

export const etiqueta = (xml: string, nombre: string): string | null =>
  etiquetas(xml, nombre)[0] ?? null;

const desescapar = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** "2026-11-10" → "20261110". */
const aaaammdd = (f: string) => f.replaceAll('-', '');
/** "20261120" → "2026-11-20". */
const deAaaammdd = (f: string) =>
  `${f.slice(0, 4)}-${f.slice(4, 6)}-${f.slice(6, 8)}`;

// ───────── Certificados ─────────

/** Genera clave privada RSA 2048 y el pedido de certificado (CSR) para ARCA. */
export function generarCsr(cuit: string, razonSocial: string) {
  const claves = forge.pki.rsa.generateKeyPair(2048);
  const csr = forge.pki.createCertificationRequest();
  csr.publicKey = claves.publicKey;
  csr.setSubject([
    { name: 'countryName', value: 'AR' },
    { name: 'organizationName', value: razonSocial || 'Centro' },
    { name: 'commonName', value: 'centro-integral' },
    { type: '2.5.4.5', value: `CUIT ${cuit}` }, // serialNumber
  ]);
  csr.sign(claves.privateKey, forge.md.sha256.create());
  return {
    clavePem: forge.pki.privateKeyToPem(claves.privateKey),
    csrPem: forge.pki.certificationRequestToPem(csr),
  };
}

/** Lee un certificado PEM: vencimiento y si corresponde a la clave. */
export function leerCertificado(certPem: string, clavePem?: string | null) {
  let cert: forge.pki.Certificate;
  try {
    cert = forge.pki.certificateFromPem(certPem);
  } catch {
    return null;
  }
  let coincide: boolean | null = null;
  if (clavePem) {
    const clave = forge.pki.privateKeyFromPem(
      clavePem,
    ) as forge.pki.rsa.PrivateKey;
    const publica = cert.publicKey as forge.pki.rsa.PublicKey;
    coincide = publica.n.equals(clave.n) && publica.e.equals(clave.e);
  }
  return { vence: cert.validity.notAfter, coincide };
}

/**
 * Firma el pedido de ticket (TRA) en CMS/PKCS#7 con el contenido incluido,
 * como espera WSAA (equivale a openssl_pkcs7_sign sin PKCS7_DETACHED).
 */
export function firmarTra(
  tra: string,
  certPem: string,
  clavePem: string,
): string {
  const cert = forge.pki.certificateFromPem(certPem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, 'utf8');
  p7.addCertificate(cert);
  p7.addSigner({
    key: forge.pki.privateKeyFromPem(clavePem),
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256!,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType!, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest! },
      {
        type: forge.pki.oids.signingTime!,
        value: new Date() as unknown as string,
      },
    ],
  });
  p7.sign();
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

/** Pedido de ticket de acceso para el servicio wsfe, válido ±10 minutos. */
export function armarTra(ahora = new Date()): string {
  const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return (
    '<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>' +
    `<uniqueId>${Math.floor(ahora.getTime() / 1000)}</uniqueId>` +
    `<generationTime>${iso(new Date(ahora.getTime() - 600_000))}</generationTime>` +
    `<expirationTime>${iso(new Date(ahora.getTime() + 600_000))}</expirationTime>` +
    '</header><service>wsfe</service></loginTicketRequest>'
  );
}

// ───────── Cliente ─────────

export interface Ticket {
  token: string;
  sign: string;
  vence: Date;
}

export interface DatosFacturaC {
  /** DNI del paciente (vacío: consumidor final sin identificar). */
  dni: string | null;
  total: number;
  /** AAAA-MM-DD */
  fecha: string;
  /** Período de las sesiones. */
  desde: string;
  hasta: string;
  vencePago: string;
}

export type ResultadoFactura =
  | {
      ok: true;
      numero: number;
      cae: string;
      caeVence: string;
      observaciones: string | null;
    }
  | { ok: false; error: string };

export class ClienteArca {
  constructor(
    private readonly o: {
      modo: ModoReal;
      cuit: string;
      ptoVta: number;
      certificado: string;
      clave: string;
      /** Ticket guardado (si todavía vale, no se pide otro). */
      ticket?: Ticket | null;
      /** Avisa un ticket nuevo para guardarlo. */
      alRenovarTicket?: (t: Ticket) => Promise<void>;
      transporte?: Transporte;
    },
  ) {}

  private get transporte(): Transporte {
    return this.o.transporte ?? transporteHttps;
  }

  /** Ticket de acceso de WSAA: reutiliza el guardado si le quedan más de 10 minutos. */
  async ticket(): Promise<Ticket> {
    const t = this.o.ticket;
    if (t && t.vence.getTime() > Date.now() + 600_000) return t;
    const cms = firmarTra(armarTra(), this.o.certificado, this.o.clave);
    const env =
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
      'xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body>' +
      `<wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
    const resp = await this.transporte(URLS[this.o.modo].wsaa, env, '');
    const ret = etiqueta(resp, 'loginCmsReturn');
    if (!ret) {
      throw new Error(
        `WSAA: ${etiqueta(resp, 'faultstring') ?? 'respuesta inválida'}`,
      );
    }
    const ta = desescapar(ret);
    const nuevo: Ticket = {
      token: etiqueta(ta, 'token') ?? '',
      sign: etiqueta(ta, 'sign') ?? '',
      vence: new Date(etiqueta(ta, 'expirationTime') ?? Date.now()),
    };
    this.o.ticket = nuevo;
    await this.o.alRenovarTicket?.(nuevo);
    return nuevo;
  }

  async ultimoComprobante(tipo = 11): Promise<number> {
    const x = await this.soap(
      'FECompUltimoAutorizado',
      `<ar:FECompUltimoAutorizado>${await this.auth()}<ar:PtoVta>${this.o.ptoVta}</ar:PtoVta>` +
        `<ar:CbteTipo>${tipo}</ar:CbteTipo></ar:FECompUltimoAutorizado>`,
    );
    const err = etiqueta(x, 'Err');
    if (err) throw new Error(`ARCA: ${etiqueta(err, 'Msg') ?? err}`);
    return Number(etiqueta(x, 'CbteNro') ?? 0);
  }

  /** Emite una Factura C de servicios a consumidor final. */
  async emitirFacturaC(f: DatosFacturaC): Promise<ResultadoFactura> {
    const numero = (await this.ultimoComprobante(11)) + 1;
    const total = f.total.toFixed(2);
    const doc = (f.dni ?? '').replace(/\D/g, '');
    const docTipo = doc ? 96 : 99;
    const body =
      `<ar:FECAESolicitar>${await this.auth()}<ar:FeCAEReq>` +
      `<ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${this.o.ptoVta}</ar:PtoVta><ar:CbteTipo>11</ar:CbteTipo></ar:FeCabReq>` +
      '<ar:FeDetReq><ar:FECAEDetRequest>' +
      '<ar:Concepto>2</ar:Concepto>' +
      `<ar:DocTipo>${docTipo}</ar:DocTipo><ar:DocNro>${doc || '0'}</ar:DocNro>` +
      `<ar:CbteDesde>${numero}</ar:CbteDesde><ar:CbteHasta>${numero}</ar:CbteHasta>` +
      `<ar:CbteFch>${aaaammdd(f.fecha)}</ar:CbteFch>` +
      `<ar:ImpTotal>${total}</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>${total}</ar:ImpNeto>` +
      '<ar:ImpOpEx>0</ar:ImpOpEx><ar:ImpTrib>0</ar:ImpTrib><ar:ImpIVA>0</ar:ImpIVA>' +
      `<ar:FchServDesde>${aaaammdd(f.desde)}</ar:FchServDesde><ar:FchServHasta>${aaaammdd(f.hasta)}</ar:FchServHasta>` +
      `<ar:FchVtoPago>${aaaammdd(f.vencePago)}</ar:FchVtoPago>` +
      '<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>' +
      '<ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>' +
      '</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar>';
    const x = await this.soap('FECAESolicitar', body);
    const mensajes = (nombre: string) =>
      etiquetas(x, nombre).map(
        (e) => `${etiqueta(e, 'Code')}: ${etiqueta(e, 'Msg')}`,
      );
    const errores = mensajes('Err');
    const obs = mensajes('Obs');
    const det = etiqueta(x, 'FECAEDetResponse');
    if (!det || etiqueta(det, 'Resultado') !== 'A') {
      return {
        ok: false,
        error: [...errores, ...obs].join(' | ') || 'Rechazada sin detalle',
      };
    }
    return {
      ok: true,
      numero,
      cae: etiqueta(det, 'CAE') ?? '',
      caeVence: deAaaammdd(etiqueta(det, 'CAEFchVto') ?? ''),
      observaciones: obs.join(' | ') || null,
    };
  }

  /** Prueba de conexión (no usa el certificado). */
  async dummy(): Promise<string> {
    const x = await this.soap('FEDummy', '<ar:FEDummy/>');
    return `App: ${etiqueta(x, 'AppServer') ?? '?'} · BD: ${etiqueta(x, 'DbServer') ?? '?'} · Auth: ${etiqueta(x, 'AuthServer') ?? '?'}`;
  }

  private async auth(): Promise<string> {
    const t = await this.ticket();
    const cuit = this.o.cuit.replace(/\D/g, '');
    return `<ar:Auth><ar:Token>${t.token}</ar:Token><ar:Sign>${t.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;
  }

  private soap(metodo: string, body: string): Promise<string> {
    const env =
      '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ' +
      `xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Header/><soapenv:Body>${body}</soapenv:Body></soapenv:Envelope>`;
    return this.transporte(
      URLS[this.o.modo].wsfe,
      env,
      `http://ar.gov.afip.dif.FEV1/${metodo}`,
    );
  }
}

/** Datos del QR que exige ARCA en la factura impresa (RG 4291). */
export function urlQr(d: {
  fecha: string;
  cuit: string;
  ptoVta: number;
  numero: number;
  total: number;
  docTipo: number;
  docNro: string;
  cae: string;
}): string {
  const datos = {
    ver: 1,
    fecha: d.fecha,
    cuit: Number(d.cuit),
    ptoVta: d.ptoVta,
    tipoCmp: 11,
    nroCmp: d.numero,
    importe: d.total,
    moneda: 'PES',
    ctz: 1,
    tipoDocRec: d.docTipo,
    nroDocRec: Number(d.docNro || 0),
    tipoCodAut: 'E',
    codAut: Number(d.cae),
  };
  return `https://www.afip.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(datos)).toString('base64')}`;
}

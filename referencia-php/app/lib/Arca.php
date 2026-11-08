<?php
/**
 * Factura electrónica ARCA (ex AFIP): WSAA (login con certificado) + WSFEv1 (Factura C).
 * Modos: 'simulado' (no llama a ARCA, CAE ficticio) | 'homologacion' | 'produccion'.
 * Necesita: certificado (.crt) y clave privada (.key) dados de alta en ARCA y un punto de venta
 * del tipo "RECE para aplicativo y web services".
 *
 * Dos formas de conectar cada profesional (ajuste arca_conexion):
 *  - 'delegado': el profesional delega el servicio wsfe al CUIT del proveedor del sistema y se usa el certificado
 *    del proveedor (storage/proveedor/). El CUIT que va en <Auth> es el del profesional (el representado).
 *  - 'propio': el profesional tiene su propio certificado (storage/pN/certs/).
 */
class Arca
{
    const URLS = [
        'homologacion' => ['wsaa' => 'https://wsaahomo.afip.gov.ar/ws/services/LoginCms', 'wsfe' => 'https://wswhomo.afip.gov.ar/wsfev1/service.asmx'],
        'produccion'   => ['wsaa' => 'https://wsaa.afip.gov.ar/ws/services/LoginCms',     'wsfe' => 'https://servicios1.afip.gov.ar/wsfev1/service.asmx'],
    ];

    public function __construct(
        private string $modo, private string $cuit, private int $ptoVta,
        private string $cert, private string $key
    ) {
        $this->cuit = preg_replace('/\D/', '', $cuit);
    }

    /** Emite una Factura C a consumidor final. $f: dni, total, fecha (Y-m-d), desde, hasta, vto */
    public function emitirFacturaC(array $f): array
    {
        if ($this->modo === 'simulado') {
            $nro = (int) val('SELECT COALESCE(MAX(numero),0) FROM facturas WHERE ' . pf() . ' AND modo = ? AND pto_vta = ?', ['simulado', $this->ptoVta]) + 1;
            return ['ok' => true, 'numero' => $nro, 'cae' => '7' . str_pad((string) random_int(0, 99999999999999), 13, '0', STR_PAD_LEFT),
                    'cae_vto' => date('Y-m-d', strtotime($f['fecha'] . ' +10 days')), 'obs' => 'SIMULADO: no tiene validez fiscal'];
        }
        $ultimo = $this->ultimoComprobante(11);
        $nro = $ultimo + 1;
        $d = fn($x) => date('Ymd', strtotime($x));
        $total = number_format((float) $f['total'], 2, '.', '');
        $doc = preg_replace('/\D/', '', (string) $f['dni']);
        $docTipo = $doc ? 96 : 99; // 96 = DNI, 99 = sin identificar
        $body = <<<XML
<ar:FECAESolicitar>
  {$this->authXml()}
  <ar:FeCAEReq>
    <ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>{$this->ptoVta}</ar:PtoVta><ar:CbteTipo>11</ar:CbteTipo></ar:FeCabReq>
    <ar:FeDetReq><ar:FECAEDetRequest>
      <ar:Concepto>2</ar:Concepto>
      <ar:DocTipo>$docTipo</ar:DocTipo><ar:DocNro>{$this->n($doc)}</ar:DocNro>
      <ar:CbteDesde>$nro</ar:CbteDesde><ar:CbteHasta>$nro</ar:CbteHasta>
      <ar:CbteFch>{$d($f['fecha'])}</ar:CbteFch>
      <ar:ImpTotal>$total</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>$total</ar:ImpNeto>
      <ar:ImpOpEx>0</ar:ImpOpEx><ar:ImpTrib>0</ar:ImpTrib><ar:ImpIVA>0</ar:ImpIVA>
      <ar:FchServDesde>{$d($f['desde'])}</ar:FchServDesde><ar:FchServHasta>{$d($f['hasta'])}</ar:FchServHasta>
      <ar:FchVtoPago>{$d($f['vto'])}</ar:FchVtoPago>
      <ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>
      <ar:CondicionIVAReceptorId>5</ar:CondicionIVAReceptorId>
    </ar:FECAEDetRequest></ar:FeDetReq>
  </ar:FeCAEReq>
</ar:FECAESolicitar>
XML;
        $x = $this->soapFe('FECAESolicitar', $body);
        $det = $x->xpath('//*[local-name()="FECAEDetResponse"]')[0] ?? null;
        $msg = fn($e) => self::h($e, 'Code') . ': ' . self::h($e, 'Msg');
        $errores = array_map($msg, $x->xpath('//*[local-name()="Err"]') ?: []);
        $obs = array_map($msg, $x->xpath('//*[local-name()="Obs"]') ?: []);
        if ($det === null || self::h($det, 'Resultado') !== 'A') {
            return ['ok' => false, 'error' => implode(' | ', array_merge($errores, $obs)) ?: 'Rechazada sin detalle'];
        }
        return ['ok' => true, 'numero' => $nro, 'cae' => self::h($det, 'CAE'),
                'cae_vto' => date('Y-m-d', strtotime(self::h($det, 'CAEFchVto'))), 'obs' => implode(' | ', $obs)];
    }

    public function ultimoComprobante(int $tipo): int
    {
        $x = $this->soapFe('FECompUltimoAutorizado', "<ar:FECompUltimoAutorizado>{$this->authXml()}<ar:PtoVta>{$this->ptoVta}</ar:PtoVta><ar:CbteTipo>$tipo</ar:CbteTipo></ar:FECompUltimoAutorizado>");
        $err = $x->xpath('//*[local-name()="Err"]');
        if ($err) throw new RuntimeException('ARCA: ' . self::h($err[0], 'Msg'));
        return (int) ($x->xpath('//*[local-name()="CbteNro"]')[0] ?? 0);
    }

    /** Prueba de conexión (no necesita certificado). */
    public function dummy(): string
    {
        $x = $this->soapFe('FEDummy', '<ar:FEDummy/>');
        return 'App: ' . ($x->xpath('//*[local-name()="AppServer"]')[0] ?? '?') . ' · BD: ' . ($x->xpath('//*[local-name()="DbServer"]')[0] ?? '?') . ' · Auth: ' . ($x->xpath('//*[local-name()="AuthServer"]')[0] ?? '?');
    }

    // ---------- internos ----------
    /** Texto de un hijo por nombre local (las respuestas usan namespace por defecto). */
    private static function h(SimpleXMLElement $el, string $nombre): string
    {
        $r = $el->xpath('./*[local-name()="' . $nombre . '"]');
        return $r ? trim((string)$r[0]) : '';
    }

    private function n(string $s): string { return $s === '' ? '0' : $s; }

    private function authXml(): string
    {
        $ta = $this->ticketAcceso();
        return "<ar:Auth><ar:Token>{$ta['token']}</ar:Token><ar:Sign>{$ta['sign']}</ar:Sign><ar:Cuit>{$this->cuit}</ar:Cuit></ar:Auth>";
    }

    /** Ticket de acceso WSAA, cacheado hasta que vence (dura 12 h). */
    private function ticketAcceso(): array
    {
        // El ticket es del certificado (sirve para todos los CUIT que lo tengan como representante)
        $cache = STORAGE . '/cache/ta_wsfe_' . $this->modo . '_' . md5($this->cert) . '.json';
        if (is_file($cache)) {
            $ta = json_decode(file_get_contents($cache), true);
            if ($ta && strtotime($ta['expira']) > time() + 600) return $ta;
        }
        if (!is_file($this->cert) || !is_file($this->key)) throw new RuntimeException(str_contains($this->cert, '/proveedor/')
            ? 'El administrador del sistema todavía no cargó el certificado del proveedor.' : 'Falta el certificado o la clave de ARCA (cargalos en Ajustes).');

        $tra = sprintf('<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header><uniqueId>%d</uniqueId><generationTime>%s</generationTime><expirationTime>%s</expirationTime></header><service>wsfe</service></loginTicketRequest>',
            time(), date('c', time() - 600), date('c', time() + 600));
        $in = tempnam(sys_get_temp_dir(), 'tra'); $out = tempnam(sys_get_temp_dir(), 'cms');
        file_put_contents($in, $tra);
        $ok = openssl_pkcs7_sign($in, $out, 'file://' . $this->cert, ['file://' . $this->key, ''], [], !PKCS7_DETACHED);
        if (!$ok) throw new RuntimeException('No se pudo firmar con el certificado: ' . openssl_error_string());
        $smime = file_get_contents($out); @unlink($in); @unlink($out);
        $cms = trim(preg_split("/\r?\n\r?\n/", $smime, 2)[1] ?? '');

        $env = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body><wsaa:loginCms><wsaa:in0>' . $cms . '</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>';
        $resp = $this->post(self::URLS[$this->modo]['wsaa'], $env, '');
        $sx = simplexml_load_string($resp);
        $ret = $sx !== false ? $sx->xpath('//*[local-name()="loginCmsReturn"]') : null;
        if (!$ret) {
            $fault = $sx !== false ? ($sx->xpath('//*[local-name()="faultstring"]')[0] ?? '') : '';
            throw new RuntimeException('WSAA: ' . ($fault ?: 'respuesta inválida'));
        }
        $ta = simplexml_load_string(html_entity_decode((string)$ret[0]));
        $data = ['token' => (string)$ta->credentials->token, 'sign' => (string)$ta->credentials->sign, 'expira' => (string)$ta->header->expirationTime];
        @mkdir(dirname($cache), 0775, true);
        file_put_contents($cache, json_encode($data));
        return $data;
    }

    private function soapFe(string $metodo, string $body): SimpleXMLElement
    {
        $env = '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Header/><soapenv:Body>' . $body . '</soapenv:Body></soapenv:Envelope>';
        $resp = $this->post(self::URLS[$this->modo]['wsfe'], $env, "http://ar.gov.afip.dif.FEV1/$metodo");
        $x = simplexml_load_string($resp);
        if ($x === false) throw new RuntimeException('Respuesta inválida de ARCA');
        return $x;
    }

    protected function post(string $url, string $xml, string $action): string
    {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_POSTFIELDS => $xml, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 60,
            CURLOPT_HTTPHEADER => ['Content-Type: text/xml; charset=utf-8', 'SOAPAction: "' . $action . '"'],
            // Los servidores de ARCA usan claves DH cortas: bajar el nivel de seguridad sólo para esta conexión
            CURLOPT_SSL_CIPHER_LIST => 'DEFAULT@SECLEVEL=1',
        ]);
        $r = curl_exec($ch);
        if ($r === false) { $e = curl_error($ch); curl_close($ch); throw new RuntimeException("No se pudo conectar con ARCA: $e"); }
        curl_close($ch);
        return $r;
    }
}

function dir_certs_proveedor(): string { return STORAGE . '/proveedor'; }
function dir_certs_propios(): string { return storage_prof() . '/certs'; }

/** Conexión con ARCA del profesional actual, según sus ajustes. */
function arca_profesional(?string $modo = null): Arca {
    $dir = ajuste('arca_conexion', 'delegado') === 'propio' ? dir_certs_propios() : dir_certs_proveedor();
    return new Arca($modo ?? ajuste('arca_modo', 'simulado'), ajuste('cuit'), (int) ajuste('pto_vta', '1'), "$dir/certificado.crt", "$dir/clave.key");
}

/** Genera clave privada + pedido de certificado (CSR) en $dir y lo descarga. */
function arca_descargar_csr(string $dir, string $cuit, string $razon): never {
    $cuit = preg_replace('/\D/', '', $cuit);
    if (strlen($cuit) !== 11) throw new RuntimeException('Primero guardá el CUIT (11 dígitos).');
    @mkdir($dir, 0700, true);
    $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
    $csr = openssl_csr_new(['countryName' => 'AR', 'organizationName' => $razon ?: 'Consultorio', 'commonName' => 'consultorio', 'serialNumber' => "CUIT $cuit"], $key, ['digest_alg' => 'sha256']);
    openssl_pkey_export_to_file($key, "$dir/clave.key");
    openssl_csr_export($csr, $pem);
    while (ob_get_level()) ob_end_clean();
    header('Content-Type: application/pkcs10'); header('Content-Disposition: attachment; filename="pedido_arca.csr"');
    echo $pem; exit;
}

/** Guarda el .crt subido en $dir (verifica que corresponda a la clave generada). */
function arca_guardar_crt(string $dir, string $campo = 'crt'): void {
    if (empty($_FILES[$campo]) || $_FILES[$campo]['error'] !== UPLOAD_ERR_OK) throw new RuntimeException('Elegí el archivo .crt');
    $crt = file_get_contents($_FILES[$campo]['tmp_name']);
    if (!openssl_x509_read($crt)) throw new RuntimeException('El archivo no es un certificado válido');
    if (is_file("$dir/clave.key") && !openssl_x509_check_private_key($crt, file_get_contents("$dir/clave.key")))
        throw new RuntimeException('El certificado no corresponde a la clave generada acá.');
    @mkdir($dir, 0700, true);
    file_put_contents("$dir/certificado.crt", $crt);
    foreach (glob(STORAGE . '/cache/ta_*.json') ?: [] as $f) @unlink($f);
}

/** Estado del certificado en $dir: ['clave' => bool, 'crt' => bool, 'vence' => ?int] */
function arca_estado_cert(string $dir): array {
    $crt = is_file("$dir/certificado.crt");
    return ['clave' => is_file("$dir/clave.key"), 'crt' => $crt,
            'vence' => $crt ? (openssl_x509_parse(file_get_contents("$dir/certificado.crt"))['validTo_time_t'] ?? null) : null];
}

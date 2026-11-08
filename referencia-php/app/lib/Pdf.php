<?php
require_once BASE . '/lib/fpdf/fpdf.php';
require_once BASE . '/lib/phpqrcode/qrlib.php';

function t(string $s): string { return mb_convert_encoding($s, 'Windows-1252', 'UTF-8'); }

/** Condición de venta según cómo se pagaron las sesiones de la factura (efectivo → Contado, transferencia → Otros medios de pago electrónico). */
function condicion_venta(int $facturaId): string
{
    $medios = array_column(q('SELECT DISTINCT medio_pago FROM sesiones WHERE ' . pf() . ' AND factura_id = ? AND medio_pago IS NOT NULL', [$facturaId])->fetchAll(), 'medio_pago');
    $nombres = ['efectivo' => 'Contado', 'transferencia' => 'Otros medios de pago electrónico'];
    $cond = array_values(array_intersect_key($nombres, array_flip($medios)));
    return $cond ? implode(' / ', $cond) : 'Contado';
}

/** Genera el PDF de la factura (formato similar al de ARCA, con QR). Devuelve la ruta relativa en storage. */
function pdf_factura(array $fac, array $pac): string
{
    $pdf = new FPDF('P', 'mm', 'A4');
    $pdf->SetAutoPageBreak(false);
    $pdf->AddPage();
    $pdf->SetDrawColor(0);

    // Encabezado
    $pdf->SetFont('Helvetica', 'B', 12);
    $pdf->Rect(10, 10, 190, 8); $pdf->SetXY(10, 10); $pdf->Cell(190, 8, 'ORIGINAL', 0, 0, 'C');
    $pdf->Rect(10, 18, 190, 48);
    $pdf->Line(105, 30, 105, 66);
    $pdf->Rect(97, 18, 16, 14); $pdf->SetFont('Helvetica', 'B', 24); $pdf->SetXY(97, 18); $pdf->Cell(16, 10, 'C', 0, 0, 'C');
    $pdf->SetFont('Helvetica', 'B', 7); $pdf->SetXY(97, 27); $pdf->Cell(16, 4, 'COD. 011', 0, 0, 'C');

    $pdf->SetFont('Helvetica', 'B', 14); $pdf->SetXY(12, 22); $pdf->MultiCell(82, 6, t(ajuste('razon_social', 'Razón social')), 0, 'C');
    $pdf->SetFont('Helvetica', '', 9);
    $y = 40; $pdf->SetRightMargin(106); $pdf->SetLeftMargin(12);
    foreach ([['Razón Social: ', ajuste('razon_social')], ['Domicilio Comercial: ', ajuste('domicilio_fiscal')], ['Condición frente al IVA: ', 'Responsable Monotributo']] as [$k, $v]) {
        $pdf->SetXY(12, $y); $pdf->SetFont('Helvetica', 'B', 8); $pdf->Write(5, t($k)); $pdf->SetFont('Helvetica', '', 8); $pdf->Write(5, t($v)); $y = max($y + 7, $pdf->GetY() + 6);
    }
    $pdf->SetRightMargin(10); $pdf->SetLeftMargin(10);
    $pdf->SetFont('Helvetica', 'B', 18); $pdf->SetXY(118, 20); $pdf->Cell(80, 10, 'FACTURA');
    $y = 32;
    $nro = str_pad((string)$fac['pto_vta'], 5, '0', STR_PAD_LEFT) . '   Comp. Nro: ' . str_pad((string)$fac['numero'], 8, '0', STR_PAD_LEFT);
    foreach ([['Punto de Venta: ', $nro], ['Fecha de Emisión: ', fecha_ar($fac['fecha'])], ['CUIT: ', ajuste('cuit')],
              ['Ingresos Brutos: ', ajuste('iibb', ajuste('cuit'))], ['Fecha de Inicio de Actividades: ', ajuste('inicio_actividades')]] as [$k, $v]) {
        $pdf->SetXY(108, $y); $pdf->SetFont('Helvetica', 'B', 8); $pdf->Write(5, t($k)); $pdf->SetFont('Helvetica', '', 8); $pdf->Write(5, t($v)); $y += 6;
    }

    // Período
    [$desde, $hasta] = mes_rango($fac['periodo']);
    $pdf->Rect(10, 68, 190, 8); $pdf->SetXY(12, 69.5); $pdf->SetFont('Helvetica', 'B', 8);
    $pdf->Write(5, t('Período Facturado Desde: ')); $pdf->SetFont('Helvetica', '', 8); $pdf->Write(5, fecha_ar($desde) . '      ');
    $pdf->SetFont('Helvetica', 'B', 8); $pdf->Write(5, 'Hasta: '); $pdf->SetFont('Helvetica', '', 8); $pdf->Write(5, fecha_ar($hasta) . '      ');
    $pdf->SetFont('Helvetica', 'B', 8); $pdf->Write(5, 'Fecha de Vto. para el pago: '); $pdf->SetFont('Helvetica', '', 8); $pdf->Write(5, fecha_ar($fac['fecha']));

    // Receptor
    $pdf->Rect(10, 78, 190, 20);
    $rec = [[12, 80, 'DNI: ', $pac['dni'] ?: '-'], [80, 80, 'Apellido y Nombre / Razón Social: ', mb_strtoupper($pac['apellido'] . ' ' . $pac['nombre'])],
            [12, 86, 'Condición frente al IVA: ', 'Consumidor Final'], [80, 86, 'Domicilio: ', $pac['domicilio'] ?: '-'],
            [12, 92, 'Condición de venta: ', condicion_venta((int) $fac['id'])]];
    foreach ($rec as [$x, $yy, $k, $v]) { $pdf->SetXY($x, $yy); $pdf->SetFont('Helvetica', 'B', 8); $pdf->Write(5, t($k)); $pdf->SetFont('Helvetica', '', 8); $pdf->Write(5, t($v)); }

    // Ítems
    $pdf->SetXY(10, 101); $pdf->SetFillColor(220); $pdf->SetFont('Helvetica', 'B', 8);
    foreach ([[18, 'Código'], [72, 'Producto / Servicio'], [18, 'Cantidad'], [18, 'U. Medida'], [22, 'Precio Unit.'], [14, '% Bonif'], [28, 'Subtotal']] as [$w, $h]) $pdf->Cell($w, 6, t($h), 1, 0, 'C', true);
    $pdf->Ln(); $pdf->SetFont('Helvetica', '', 8);
    foreach (json_decode($fac['detalle'], true) as $it) {
        $pdf->SetX(10);
        $pdf->Cell(18, 6, '', 0); $pdf->Cell(72, 6, t($it['descripcion']), 0);
        $pdf->Cell(18, 6, number_format($it['cantidad'], 2, ',', '.'), 0, 0, 'R'); $pdf->Cell(18, 6, 'unidades', 0, 0, 'C');
        $pdf->Cell(22, 6, number_format($it['precio'], 2, ',', '.'), 0, 0, 'R'); $pdf->Cell(14, 6, '0,00', 0, 0, 'R');
        $pdf->Cell(28, 6, number_format($it['cantidad'] * $it['precio'], 2, ',', '.'), 0, 1, 'R');
    }

    // Totales
    $pdf->Rect(10, 215, 190, 24); $pdf->SetFont('Helvetica', 'B', 9);
    foreach ([[219, 'Subtotal: $'], [226, 'Importe Otros Tributos: $'], [233, 'Importe Total: $']] as $i => [$yy, $k]) {
        $pdf->SetXY(110, $yy); $pdf->Cell(60, 5, $k, 0, 0, 'R'); $pdf->Cell(28, 5, number_format($i === 1 ? 0 : (float)$fac['total'], 2, ',', '.'), 0, 0, 'R');
    }

    // QR + CAE
    $qr = ['ver' => 1, 'fecha' => $fac['fecha'], 'cuit' => (int) preg_replace('/\D/', '', ajuste('cuit', '0')), 'ptoVta' => (int)$fac['pto_vta'],
           'tipoCmp' => 11, 'nroCmp' => (int)$fac['numero'], 'importe' => (float)$fac['total'], 'moneda' => 'PES', 'ctz' => 1,
           'tipoDocRec' => $pac['dni'] ? 96 : 99, 'nroDocRec' => (int) preg_replace('/\D/', '', $pac['dni'] ?: '0'), 'tipoCodAut' => 'E', 'codAut' => (int)$fac['cae']];
    $png = tempnam(sys_get_temp_dir(), 'qr') . '.png';
    $er = error_reporting(E_ALL & ~E_DEPRECATED & ~E_WARNING); // phpqrcode es antigua: avisos inofensivos en PHP 8
    QRcode::png('https://www.afip.gob.ar/fe/qr/?p=' . base64_encode(json_encode($qr)), $png, QR_ECLEVEL_M, 4, 1);
    error_reporting($er);
    $pdf->Image($png, 10, 242, 32, 32); @unlink($png);
    $pdf->SetFont('Helvetica', 'B', 9);
    $pdf->SetXY(140, 250); $pdf->Cell(30, 5, t('CAE N°:'), 0, 0, 'R'); $pdf->SetFont('Helvetica', '', 9); $pdf->Cell(30, 5, $fac['cae']);
    $pdf->SetFont('Helvetica', 'B', 9); $pdf->SetXY(140, 256); $pdf->Cell(30, 5, 'Fecha de Vto. de CAE:', 0, 0, 'R'); $pdf->SetFont('Helvetica', '', 9); $pdf->Cell(30, 5, fecha_ar($fac['cae_vto']));
    $pdf->SetFont('Helvetica', 'BI', 9); $pdf->SetXY(45, 250); $pdf->Cell(60, 5, 'Comprobante Autorizado');

    if ($fac['modo'] !== 'produccion') {
        $pdf->SetTextColor(200, 0, 0); $pdf->SetFont('Helvetica', 'B', 22);
        $pdf->SetXY(10, 160); $pdf->Cell(190, 12, t($fac['modo'] === 'simulado' ? 'SIMULADO - SIN VALIDEZ FISCAL' : 'HOMOLOGACIÓN - SIN VALIDEZ FISCAL'), 0, 0, 'C');
        $pdf->SetTextColor(0);
    }

    // Carpeta "emitidas-AAAA-MM" (mes de emisión, como lo hace hoy) y nombre "Apellido Nombre"
    $carpeta = 'facturas/emitidas-' . substr($fac['fecha'], 0, 7);
    @mkdir(storage_prof() . "/$carpeta", 0775, true);
    $base = nombre_archivo($pac['apellido'] . ' ' . $pac['nombre']);
    $rel = "$carpeta/$base.pdf"; $i = 2;
    while (is_file(storage_prof() . "/$rel")) $rel = "$carpeta/$base (" . $i++ . ").pdf";
    $pdf->Output('F', storage_prof() . "/$rel");
    return $rel;
}

/** Planilla de sesiones OSEP para pacientes sin token (para firmar y presentar en el Colegio). */
function pdf_planilla(array $orden, array $pac, array $sesiones): string
{
    $pdf = new FPDF('L', 'mm', 'A4');
    $pdf->AddPage();
    $pdf->SetFont('Helvetica', 'B', 14);
    $pdf->Cell(0, 8, t('Planilla de sesiones - OSEP'), 0, 1);
    $pdf->SetFont('Helvetica', '', 10);
    $pdf->Cell(140, 6, t('Paciente: ' . nombre_pac($pac)), 0, 0); $pdf->Cell(0, 6, t('N° afiliado: ' . ($pac['nro_afiliado'] ?? '')), 0, 1);
    $pdf->Cell(140, 6, t('Profesional: ' . ajuste('profesional') . '  ' . ajuste('matricula')), 0, 0); $pdf->Cell(0, 6, t('N° autorización: ' . $orden['nro_autorizacion']), 0, 1);
    $pdf->Cell(0, 6, t('Período: ' . mes_nombre($orden['mes'])), 0, 1);
    $pdf->Ln(3);
    $cols = [[28, 'N° de Sesión'], [40, 'Código'], [36, 'Fecha'], [28, 'Hora'], [72, 'Firma del Paciente'], [73, 'Firma del Profesional']];
    $pdf->SetFillColor(50); $pdf->SetTextColor(255); $pdf->SetFont('Helvetica', 'B', 10);
    foreach ($cols as [$w, $h]) $pdf->Cell($w, 10, t($h), 1, 0, 'C', true);
    $pdf->Ln(); $pdf->SetTextColor(0); $pdf->SetFont('Helvetica', '', 11);
    for ($i = 0; $i < max(8, (int)$orden['cantidad']); $i++) {
        $s = $sesiones[$i] ?? null;
        $pdf->Cell(28, 16, (string)($i + 1), 1, 0, 'C');
        $pdf->Cell(40, 16, $s ? (string)($orden['codigo_practica'] ?? '') : '', 1, 0, 'C');
        $pdf->Cell(36, 16, $s ? fecha_ar($s['fecha_osep'] ?: $s['fecha']) : '     /      /', 1, 0, 'C');
        $pdf->Cell(28, 16, $s['hora'] ?? '', 1, 0, 'C');
        $pdf->Cell(72, 16, '', 1); $pdf->Cell(73, 16, '', 1, 1);
    }
    @mkdir(storage_prof() . '/planillas', 0775, true);
    $rel = 'planillas/' . nombre_archivo($orden['mes'] . ' ' . $pac['apellido'] . ' ' . $pac['nombre']) . '.pdf';
    $pdf->Output('F', storage_prof() . "/$rel");
    return $rel;
}

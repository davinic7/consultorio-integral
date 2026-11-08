<?php
require_once BASE . '/app/lib/Arca.php';
require_once BASE . '/app/lib/Pdf.php';
$titulo = 'Facturación';
$mes = preg_match('/^\d{4}-\d{2}$/', (string) in('mes')) ? in('mes') : mes_anterior();
$modo = ajuste('arca_modo', 'simulado');

function emitir_factura(array $r, string $mes, string $modo): array {
    [$desde, $hasta] = mes_rango($mes);
    $hoy = date('Y-m-d');
    $texto = ajuste('texto_item', 'Honorarios profesionales por psicoterapia individual');
    $items = array_map(fn($it) => ['descripcion' => $texto, 'cantidad' => $it['cantidad'], 'precio' => $it['precio']], $r['items']);
    $arca = arca_profesional($modo);
    $res = $arca->emitirFacturaC(['dni' => $r['dni'], 'total' => $r['total'], 'fecha' => $hoy, 'desde' => $desde, 'hasta' => $hasta, 'vto' => $hoy]);
    $fac = ['paciente_id' => $r['paciente_id'], 'periodo' => $mes, 'fecha' => $hoy, 'pto_vta' => (int) ajuste('pto_vta', '1'), 'cbte_tipo' => 11,
            'numero' => $res['numero'] ?? null, 'cantidad' => $r['cantidad'], 'detalle' => json_encode($items, JSON_UNESCAPED_UNICODE),
            'total' => $r['total'], 'cae' => $res['cae'] ?? null, 'cae_vto' => $res['cae_vto'] ?? null, 'modo' => $modo,
            'estado' => $res['ok'] ? 'emitida' : 'rechazada', 'error' => $res['ok'] ? ($res['obs'] ?? null) : $res['error'], 'creado' => date('Y-m-d H:i:s')];
    $fid = insert('facturas', $fac);
    if (!$res['ok']) return [false, $res['error']];
    $ids = array_column($r['a_facturar'], 'id');
    q('UPDATE sesiones SET factura_id = ? WHERE ' . pf() . ' AND id IN (' . implode(',', array_map('intval', $ids)) . ')', [$fid]);
    $pac = paciente_propio((int) $r['paciente_id']);
    $pdf = pdf_factura(['id' => $fid] + $fac, $pac);
    update('facturas', $fid, ['pdf' => $pdf]);
    return [true, $fid];
}

if (es_post()) {
    $acc = in('accion');
    if ($acc === 'emitir') {
        if (!ajuste('cuit') && $modo !== 'simulado') throw new RuntimeException('Completá el CUIT en Ajustes.');
        $sel = array_map('intval', (array)($_POST['pac'] ?? []));
        $ok = 0; $errores = [];
        foreach (resumen_facturacion($mes) as $r) {
            if (!in_array($r['paciente_id'], $sel, true) || !$r['cantidad']) continue;
            try {
                [$bien, $info] = emitir_factura($r, $mes, $modo);
                $bien ? $ok++ : $errores[] = e(nombre_pac($r)) . ': ' . e($info);
            } catch (Throwable $ex) { $errores[] = e(nombre_pac($r)) . ': ' . e($ex->getMessage()); break; }
        }
        if ($ok) flash("Se emitieron $ok facturas.");
        if ($errores) flash('No se pudieron emitir:<br>' . implode('<br>', $errores), 'danger');
    } elseif ($acc === 'enviada') {
        q('UPDATE facturas SET enviada = ? WHERE ' . pf() . ' AND id = ?', [in('valor') ? 1 : 0, (int) in('factura_id')]);
    }
    redir('facturacion', ['mes' => $mes]);
}

$resumen = resumen_facturacion($mes);
$emitidas = rows("SELECT f.*, p.apellido, p.nombre, p.telefono FROM facturas f JOIN pacientes p ON p.id = f.paciente_id
                  WHERE " . pf('f') . " AND f.periodo = ? AND f.estado = 'emitida' ORDER BY p.apellido, p.nombre", [$mes]);
$enviadas = count(array_filter($emitidas, fn($f) => $f['enviada']));
$pendientes = array_filter($resumen, fn($r) => $r['cantidad'] > 0);
$avisos = array_filter($resumen, fn($r) => $r['impagas'] || $r['sin_marcar']);
?>
<div class="d-flex flex-wrap align-items-center gap-2 mb-2">
  <h1 class="h3 me-auto mb-0">Facturación de <?= mes_nombre($mes) ?></h1>
  <a class="btn btn-sm btn-outline-secondary" href="<?= url('facturacion', ['mes' => mes_anterior($mes)]) ?>">‹</a>
  <a class="btn btn-sm btn-outline-secondary" href="<?= url('facturacion', ['mes' => date('Y-m', strtotime("$mes-01 +1 month"))]) ?>">›</a>
</div>
<?php if ($modo !== 'produccion'): ?>
  <div class="alert alert-warning py-2 small">Modo <b><?= e($modo) ?></b>: las facturas <b>no tienen validez fiscal</b>. Cambialo en Ajustes cuando el certificado de ARCA esté listo.</div>
<?php endif ?>

<?php if ($avisos): ?>
<div class="alert alert-light border small">
  <b>Revisar antes de facturar:</b>
  <ul class="mb-0"><?php foreach ($avisos as $r): ?>
    <li><a href="<?= url('paciente', ['id' => $r['paciente_id']]) ?>"><?= e(nombre_pac($r)) ?></a>:
      <?= $r['impagas'] ? $r['impagas'] . ' sesión(es) cobrables sin pago registrado' : '' ?>
      <?= $r['impagas'] && $r['sin_marcar'] ? ' · ' : '' ?><?= $r['sin_marcar'] ? $r['sin_marcar'] . ' sin marcar' : '' ?></li>
  <?php endforeach ?></ul>
</div>
<?php endif ?>

<h2 class="h5 mt-3">Para facturar (<?= count($pendientes) ?>)</h2>
<?php if (!$pendientes): ?><p class="text-muted">No hay sesiones pagadas sin factura en este mes.</p><?php else: ?>
<form method="post" onsubmit="return confirm('Revisá los totales. ¿Emitir las facturas seleccionadas?')">
  <?= csrf_field() ?><input type="hidden" name="accion" value="emitir">
  <div class="card"><div class="table-responsive"><table class="table mb-0 tabla-compacta">
    <thead><tr><th><input type="checkbox" checked onclick="document.querySelectorAll('.chk').forEach(c => c.checked = this.checked)"></th><th>Paciente</th><th>DNI</th><th>Detalle</th><th class="text-end">Total</th></tr></thead>
    <tbody>
    <?php foreach ($pendientes as $r): ?>
      <tr>
        <td><input type="checkbox" class="chk" name="pac[]" value="<?= $r['paciente_id'] ?>" <?= $r['dni'] ? 'checked' : '' ?>></td>
        <td><?= e(nombre_pac($r)) ?><?= !$r['domicilio'] ? ' <span class="badge text-bg-warning">sin domicilio</span>' : '' ?></td>
        <td><?= $r['dni'] ? e($r['dni']) : '<span class="badge text-bg-danger">falta DNI</span>' ?></td>
        <td class="small"><?php foreach ($r['items'] as $it): ?><?= $it['cantidad'] ?> × <?= pesos($it['precio']) ?><br><?php endforeach ?>
          <span class="text-muted"><?= $r['efectivo'] ? $r['efectivo'] . ' efvo ' : '' ?><?= $r['transferencia'] ? $r['transferencia'] . ' transf' : '' ?></span></td>
        <td class="text-end fw-bold"><?= pesos($r['total']) ?></td>
      </tr>
    <?php endforeach ?>
    </tbody>
    <tfoot><tr><td colspan="4" class="text-end">Total</td><td class="text-end fw-bold"><?= pesos(array_sum(array_column($pendientes, 'total'))) ?></td></tr></tfoot>
  </table></div></div>
  <button class="btn btn-primary mt-2">Emitir facturas seleccionadas</button>
</form>
<?php endif ?>

<h2 class="h5 mt-4">Emitidas (<?= $enviadas ?>/<?= count($emitidas) ?> enviadas)</h2>
<?php if ($emitidas): ?><div class="progress mb-2" style="height:6px"><div class="progress-bar bg-success" style="width:<?= round(100 * $enviadas / count($emitidas)) ?>%"></div></div><?php endif ?>
<?php foreach ($emitidas as $f):
    $pdfUrl = url('archivo', ['f' => $f['pdf']]);
    $msg = strtr(ajuste('mensaje_wa_factura', 'Hola {nombre}, te envío la factura de las sesiones de {mes}. ¡Gracias!'), ['{nombre}' => $f['nombre'], '{mes}' => MESES[(int)substr($f['periodo'], 5)]]);
    $wa = wa_link($f['telefono'], $msg); ?>
  <div class="card mb-2 <?= $f['enviada'] ? 'opacity-75' : '' ?>"><div class="card-body py-2 d-flex flex-wrap gap-2 align-items-center">
    <div class="me-auto"><?= $f['enviada'] ? '✅' : '⬜' ?> <b><?= e(nombre_pac($f)) ?></b>
      <span class="small text-muted">N° <?= str_pad((string)$f['numero'], 8, '0', STR_PAD_LEFT) ?> · <?= pesos($f['total']) ?></span></div>
    <a class="btn btn-sm btn-outline-secondary" target="_blank" href="<?= $pdfUrl ?>">Ver</a>
    <button class="btn btn-sm btn-success" onclick="compartirPdf('<?= $pdfUrl ?>', '<?= e(basename($f['pdf'])) ?>', <?= e(json_encode($msg)) ?>).then(ok => { if (ok) document.getElementById('env<?= $f['id'] ?>').submit() })">Compartir PDF</button>
    <?php if ($wa): ?><a class="btn btn-sm btn-outline-success" target="_blank" href="<?= e($wa) ?>">Abrir chat</a><?php endif ?>
    <form method="post" id="env<?= $f['id'] ?>"><?= csrf_field() ?><input type="hidden" name="accion" value="enviada"><input type="hidden" name="factura_id" value="<?= $f['id'] ?>"><input type="hidden" name="valor" value="<?= $f['enviada'] ? 0 : 1 ?>">
      <button class="btn btn-sm <?= $f['enviada'] ? 'btn-outline-secondary' : 'btn-outline-primary' ?>"><?= $f['enviada'] ? 'Desmarcar' : 'Marcar enviada' ?></button></form>
  </div></div>
<?php endforeach ?>
<?php if (!$emitidas): ?><p class="text-muted">Todavía no hay facturas emitidas de este mes.</p><?php endif ?>

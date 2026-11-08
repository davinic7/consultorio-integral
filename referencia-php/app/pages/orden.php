<?php
require_once BASE . '/app/lib/Pdf.php';
$id = (int) in('id');
$orden = $id ? row('SELECT * FROM ordenes_osep WHERE ' . pf() . ' AND id = ?', [$id]) : null;
if ($id && !$orden) throw new RuntimeException('Orden no encontrada');
$pid = $orden ? (int)$orden['paciente_id'] : (int) in('paciente_id');
$pac = $pid ? paciente_propio($pid) : null;

if (es_post()) {
    $acc = in('accion');
    if ($acc === 'guardar_orden') {
        $d = ['paciente_id' => (int) in('paciente_id'), 'nro_autorizacion' => preg_replace('/\s/', '', in('nro_autorizacion')),
              'fecha_compra' => in('fecha_compra'), 'cantidad' => max(1, (int) in('cantidad')), 'mes' => substr(in('mes'), 0, 7),
              'fecha_vencimiento' => nulo(in('fecha_vencimiento')), 'codigo_practica' => nulo(preg_replace('/[^0-9-]/', '', in('codigo_practica'))),
              'observaciones' => nulo(in('observaciones'))];
        paciente_propio($d['paciente_id']);
        if ($f = subir_archivo('foto', 'ordenes', ['jpg', 'jpeg', 'png', 'webp', 'pdf'])) $d['foto'] = $f;
        if ($orden) update('ordenes_osep', $id, $d);
        else { $d['creado'] = date('Y-m-d H:i:s'); $id = insert('ordenes_osep', $d); }
        if ($na = in('nro_afiliado')) q('UPDATE pacientes SET nro_afiliado = ? WHERE ' . pf() . ' AND id = ?', [$na, $d['paciente_id']]);
        flash('Orden guardada');
        redir('orden', ['id' => $id]);
    }
    if (!$orden) redir('osep');
    if ($acc === 'guardar_carga') {
        foreach ((array)($_POST['s'] ?? []) as $sid => $v) {
            update('sesiones', (int)$sid, ['orden_id' => $id, 'fecha_osep' => nulo($v['fecha_osep'] ?? ''), 'token' => nulo(trim($v['token'] ?? '')),
                'cargada_osep' => !empty($v['cargada']) ? 1 : 0]);
        }
        flash('Carga guardada');
    } elseif ($acc === 'resugerir') {
        q('UPDATE sesiones SET fecha_osep = NULL WHERE ' . pf() . ' AND orden_id = ? AND cargada_osep = 0', [$id]);
        flash('Fechas recalculadas');
    } elseif ($acc === 'planilla') {
        [$i0, $f0] = mes_rango($orden['mes']);
        $ses = rows("SELECT * FROM sesiones WHERE " . pf() . " AND paciente_id = ? AND fecha BETWEEN ? AND ? AND estado = 'asistio' AND (orden_id IS NULL OR orden_id = ?) ORDER BY COALESCE(fecha_osep, fecha)", [$pid, $i0, $f0, $id]);
        $ses = array_slice($ses, 0, (int)$orden['cantidad']);
        $rel = pdf_planilla($orden, $pac, $ses);
        redir('archivo', ['f' => $rel]);
    } elseif ($acc === 'presentada') {
        update('ordenes_osep', $id, ['planilla_presentada' => in('valor') ? 1 : 0]);
    } elseif ($acc === 'borrar' && !val('SELECT COUNT(*) FROM sesiones WHERE ' . pf() . ' AND orden_id = ? AND cargada_osep = 1', [$id])) {
        q('UPDATE sesiones SET orden_id = NULL, fecha_osep = NULL WHERE ' . pf() . ' AND orden_id = ?', [$id]);
        q('DELETE FROM ordenes_osep WHERE ' . pf() . ' AND id = ?', [$id]);
        flash('Orden eliminada'); redir('osep', ['mes' => $orden['mes']]);
    }
    redir('orden', ['id' => $id]);
}

$titulo = $orden ? 'Orden OSEP' : 'Registrar orden OSEP';
$v = fn($c, $def = '') => e($orden[$c] ?? $def);
?>
<h1 class="h3"><?= e($titulo) ?><?= $pac ? ' · ' . e(nombre_pac($pac)) : '' ?></h1>

<?php if (!$orden): ?>
<form method="post" enctype="multipart/form-data" class="card card-body" style="max-width:640px" id="form-orden"
      data-pacientes="<?= e(json_encode(array_map(fn($p) => ['id' => (int)$p['id'], 'dni' => $p['dni'], 'afil' => $p['nro_afiliado'], 'n' => nombre_pac($p)],
          rows("SELECT id, apellido, nombre, dni, nro_afiliado FROM pacientes WHERE " . pf() . " AND cobertura = 'osep' AND activo = 1")))) ?>"
      data-fijo="<?= $pac ? (int)$pac['id'] : '' ?>">
  <?= csrf_field() ?><input type="hidden" name="accion" value="guardar_orden">
  <div class="row g-2">
    <div class="col-12"><label class="form-label small">Paciente</label>
      <?php if ($pac): ?><input type="hidden" name="paciente_id" value="<?= $pid ?>"><div class="form-control-plaintext"><?= e(nombre_pac($pac)) ?></div>
      <?php else: ?><?= select_pacientes('paciente_id') ?><?php endif ?></div>
    <div class="col-12"><label class="form-label small">Foto de la orden (la que manda el paciente)</label><input type="file" class="form-control" name="foto" id="orden-foto" accept="image/*,application/pdf">
      <div id="orden-estado" class="small mt-1 text-muted">Al elegir la foto, el sistema la lee y completa los datos. Revisalos antes de guardar.</div></div>
    <div class="col-md-6"><label class="form-label small">N° de autorización</label><input class="form-control" name="nro_autorizacion" required inputmode="numeric"></div>
    <div class="col-md-6"><label class="form-label small">N° de afiliado</label><input class="form-control" name="nro_afiliado" value="<?= e($pac['nro_afiliado'] ?? '') ?>"></div>
    <div class="col-6 col-md-4"><label class="form-label small">Fecha de compra</label><input type="date" class="form-control" name="fecha_compra" value="<?= date('Y-m-d') ?>" required></div>
    <div class="col-6 col-md-4"><label class="form-label small">Cantidad de sesiones</label><input type="number" class="form-control" name="cantidad" value="8" min="1" required></div>
    <div class="col-md-4"><label class="form-label small">Mes de las sesiones</label><input type="month" class="form-control" name="mes" value="<?= e(in('mes') ?: date('Y-m')) ?>" required></div>
    <div class="col-6 col-md-4"><label class="form-label small">Vence</label><input type="date" class="form-control" name="fecha_vencimiento"></div>
    <div class="col-6 col-md-4"><label class="form-label small">Código de práctica</label><input class="form-control" name="codigo_practica" placeholder="01-330202-00" inputmode="numeric"></div>
    <div class="col-12"><label class="form-label small">Observaciones</label><input class="form-control" name="observaciones"></div>
  </div>
  <button class="btn btn-primary mt-3">Guardar orden</button>
</form>
<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"></script>
<script src="assets/orden-ocr.js"></script>
<script src="assets/orden.js"></script>
<?php return; endif;

// ---- Asistente de carga ----
[$ini, $fin] = mes_rango($orden['mes']);
$ses = rows("SELECT * FROM sesiones WHERE " . pf() . " AND paciente_id = ? AND fecha BETWEEN ? AND ? AND estado = 'asistio' AND (orden_id IS NULL OR orden_id = ?) ORDER BY fecha", [$pid, $ini, $fin, $id]);
$ses = array_slice($ses, 0, (int)$orden['cantidad']);
$ocupadas = array_column(rows('SELECT fecha_osep FROM sesiones WHERE ' . pf() . ' AND paciente_id = ? AND fecha_osep IS NOT NULL AND (orden_id IS NULL OR orden_id <> ?)', [$pid, $id]), 'fecha_osep');
// Las ya cargadas cuentan como ocupadas; el resto se sugiere
$fijas = array_filter($ses, fn($s) => $s['cargada_osep'] && $s['fecha_osep']);
$libres = array_values(array_filter($ses, fn($s) => !($s['cargada_osep'] && $s['fecha_osep'])));
$sug = sugerir_fechas_osep($orden['fecha_compra'], $orden['mes'], array_column($libres, 'fecha'), array_merge($ocupadas, array_column($fijas, 'fecha_osep')), $orden['fecha_vencimiento'] ?: null);
$maxFecha = $orden['fecha_vencimiento'] && $orden['fecha_vencimiento'] < $fin ? $orden['fecha_vencimiento'] : $fin;
$sugPorId = [];
foreach ($libres as $i => $s) $sugPorId[$s['id']] = $sug[$i];
$cargadas = count($fijas);
?>
<div class="row g-3">
  <div class="col-lg-4">
    <div class="card card-body">
      <?php if ($orden['foto']): ?>
        <?php if (str_ends_with($orden['foto'], '.pdf')): ?><a href="<?= url('archivo', ['f' => $orden['foto']]) ?>" target="_blank">Ver orden (PDF)</a>
        <?php else: ?><a href="<?= url('archivo', ['f' => $orden['foto']]) ?>" target="_blank"><img src="<?= url('archivo', ['f' => $orden['foto']]) ?>" class="img-fluid rounded mb-2" alt="Orden"></a><?php endif ?>
      <?php endif ?>
      <dl class="row small mb-0">
        <dt class="col-5">Autorización</dt><dd class="col-7"><span class="copiable btn btn-sm btn-light" data-copiar="<?= $v('nro_autorizacion') ?>">📋 <?= $v('nro_autorizacion') ?></span></dd>
        <dt class="col-5">Afiliado</dt><dd class="col-7"><span class="copiable btn btn-sm btn-light" data-copiar="<?= e($pac['nro_afiliado']) ?>">📋 <?= e($pac['nro_afiliado'] ?: '—') ?></span></dd>
        <dt class="col-5">Compra</dt><dd class="col-7"><?= fecha_ar($orden['fecha_compra']) ?></dd>
        <?php if ($orden['fecha_vencimiento']): ?><dt class="col-5">Vence</dt><dd class="col-7"><?= fecha_ar($orden['fecha_vencimiento']) ?></dd><?php endif ?>
        <?php if ($orden['codigo_practica']): ?><dt class="col-5">Código</dt><dd class="col-7"><span class="copiable" data-copiar="<?= $v('codigo_practica') ?>"><?= $v('codigo_practica') ?></span></dd><?php endif ?>
        <dt class="col-5">Sesiones</dt><dd class="col-7"><?= (int)$orden['cantidad'] ?> · mes <?= mes_nombre($orden['mes']) ?></dd>
        <dt class="col-5">Cargadas</dt><dd class="col-7"><?= $cargadas ?> / <?= count($ses) ?> asistidas</dd>
      </dl>
      <?php if ($sia = ajuste('osep_url')): ?><a class="btn btn-info btn-sm mt-2" target="_blank" href="<?= e($sia) ?>">Abrir SIA OSEP</a><?php endif ?>
      <details class="mt-3"><summary class="small">Editar orden</summary>
        <form method="post" enctype="multipart/form-data" class="mt-2"><?= csrf_field() ?><input type="hidden" name="accion" value="guardar_orden"><input type="hidden" name="paciente_id" value="<?= $pid ?>">
          <input class="form-control form-control-sm mb-1" name="nro_autorizacion" value="<?= $v('nro_autorizacion') ?>">
          <input type="date" class="form-control form-control-sm mb-1" name="fecha_compra" value="<?= $v('fecha_compra') ?>" title="Compra">
          <input type="date" class="form-control form-control-sm mb-1" name="fecha_vencimiento" value="<?= $v('fecha_vencimiento') ?>" title="Vence">
          <input class="form-control form-control-sm mb-1" name="codigo_practica" value="<?= $v('codigo_practica') ?>" placeholder="Código de práctica">
          <input type="number" class="form-control form-control-sm mb-1" name="cantidad" value="<?= $v('cantidad') ?>">
          <input type="month" class="form-control form-control-sm mb-1" name="mes" value="<?= $v('mes') ?>">
          <input type="file" class="form-control form-control-sm mb-1" name="foto" accept="image/*,application/pdf">
          <button class="btn btn-sm btn-outline-primary">Guardar</button>
        </form>
        <form method="post" class="mt-2"><?= csrf_field() ?><input type="hidden" name="accion" value="borrar"><button class="btn btn-sm btn-outline-danger" onclick="return confirm('¿Eliminar la orden?')">Eliminar orden</button></form>
      </details>
    </div>
  </div>
  <div class="col-lg-8">
    <div class="card card-body">
      <h2 class="h5">Pasos en el SIA (una vez por sesión)</h2>
      <ol class="small mb-3">
        <li>Autorizaciones Consultorio → <b>Autorizaciones en Prestador</b>.</li>
        <li>Modalidad: <b>Consumo de autorización previa</b> → pegar N° de autorización y N° de afiliado (Organización única) → Confirmar.</li>
        <li>Poner la <b>fecha</b> de la tabla<?= $pac['usa_token'] ? ' y el <b>token</b>' : ' (sin token)' ?> → Confirmar → tildar "Cargada".</li>
      </ol>
      <form method="post">
        <?= csrf_field() ?><input type="hidden" name="accion" value="guardar_carga">
        <div class="table-responsive"><table class="table tabla-compacta">
          <thead><tr><th>#</th><th>Atendida</th><th>Fecha a cargar</th><?php if ($pac['usa_token']): ?><th>Token</th><?php endif ?><th>Cargada</th></tr></thead>
          <tbody>
          <?php foreach ($ses as $i => $s):
              $sg = $sugPorId[$s['id']] ?? null;
              $fecha = $s['fecha_osep'] ?: ($sg['sugerida'] ?? ''); ?>
            <tr class="<?= $s['cargada_osep'] ? 'table-success' : '' ?>">
              <td><?= $i + 1 ?></td>
              <td><?= fecha_ar($s['fecha']) ?></td>
              <td><input type="date" class="form-control form-control-sm" name="s[<?= $s['id'] ?>][fecha_osep]" value="<?= e($fecha) ?>" min="<?= e($orden['fecha_compra']) ?>" max="<?= e($maxFecha) ?>">
                <?php if ($fecha && $fecha > $maxFecha): ?><div class="small text-danger">Después del vencimiento de la orden</div><?php endif ?>
                <?php if ($sg && $sg['aviso'] && !$s['fecha_osep']): ?><div class="small text-<?= $sg['sugerida'] ? 'muted' : 'danger' ?>"><?= e($sg['aviso']) ?></div><?php endif ?>
                <?php if ($fecha): ?><span class="copiable small text-primary" data-copiar="<?= fecha_ar($fecha) ?>">📋 <?= fecha_ar($fecha) ?></span><?php endif ?></td>
              <?php if ($pac['usa_token']): ?><td><input class="form-control form-control-sm" name="s[<?= $s['id'] ?>][token]" value="<?= e($s['token']) ?>" autocapitalize="characters" autocomplete="off" spellcheck="false" style="max-width:110px">
                <?php if ($s['token']): ?><span class="copiable small text-primary" data-copiar="<?= e($s['token']) ?>">📋 copiar</span><?php endif ?></td><?php endif ?>
              <td><input type="checkbox" class="form-check-input" name="s[<?= $s['id'] ?>][cargada]" value="1" <?= $s['cargada_osep'] ? 'checked' : '' ?>></td>
            </tr>
          <?php endforeach ?>
          <?php if (!$ses): ?><tr><td colspan="5" class="text-muted">No hay sesiones marcadas como "Asistió" en <?= mes_nombre($orden['mes']) ?>.</td></tr><?php endif ?>
          </tbody>
        </table></div>
        <?php if ($ses): ?><button class="btn btn-primary">Guardar</button><?php endif ?>
      </form>
      <div class="d-flex flex-wrap gap-2 mt-2">
        <form method="post"><?= csrf_field() ?><input type="hidden" name="accion" value="resugerir"><button class="btn btn-sm btn-outline-secondary">Recalcular fechas sugeridas</button></form>
        <?php if (!$pac['usa_token']): ?>
          <form method="post" target="_blank"><?= csrf_field() ?><input type="hidden" name="accion" value="planilla"><button class="btn btn-sm btn-outline-dark">Imprimir planilla para firmar</button></form>
          <form method="post"><?= csrf_field() ?><input type="hidden" name="accion" value="presentada"><input type="hidden" name="valor" value="<?= $orden['planilla_presentada'] ? 0 : 1 ?>">
            <button class="btn btn-sm <?= $orden['planilla_presentada'] ? 'btn-success' : 'btn-outline-success' ?>"><?= $orden['planilla_presentada'] ? '✓ Planilla presentada en el Colegio' : 'Marcar planilla presentada' ?></button></form>
        <?php endif ?>
      </div>
    </div>
  </div>
</div>

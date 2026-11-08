<?php
$titulo = 'Pacientes';
sincronizar_precios();
if (es_post() && in('accion') === 'aumento') {
    $desde = in('desde') ?: date('Y-m-01', strtotime('first day of next month'));
    $n = 0;
    foreach ((array)($_POST['nuevo'] ?? []) as $viejo => $nuevo) {
        $nuevo = (float) str_replace(',', '.', (string)$nuevo);
        if ($nuevo <= 0 || abs($nuevo - (float)$viejo) < 0.001) continue;
        foreach (rows("SELECT id FROM pacientes WHERE " . pf() . " AND activo = 1 AND cobertura = 'particular' AND precio_sesion = ?", [$viejo]) as $p) {
            cambiar_precio((int)$p['id'], $nuevo, $desde); $n++;
        }
    }
    if (in('precio_nuevos') !== '') guardar_ajuste('precio_nuevos', str_replace(',', '.', in('precio_nuevos')));
    flash("Aumento aplicado a $n pacientes desde el " . fecha_ar($desde));
    redir('pacientes');
}

$buscar = in('q');
$verBajas = (bool) in('bajas');
$sql = 'SELECT p.*, (SELECT MAX(fecha) FROM sesiones s WHERE s.paciente_id = p.id AND s.estado = \'asistio\') AS ultima FROM pacientes p WHERE ' . pf('p') . ' AND p.activo = ?';
$par = [$verBajas ? 0 : 1];
if ($buscar !== '') { $sql .= ' AND (p.apellido LIKE ? OR p.nombre LIKE ? OR p.dni LIKE ?)'; array_push($par, "%$buscar%", "%$buscar%", "%$buscar%"); }
$pacs = rows($sql . ' ORDER BY p.apellido, p.nombre', $par);
$precios = rows("SELECT precio_sesion, COUNT(*) AS n FROM pacientes WHERE " . pf() . " AND activo = 1 AND cobertura = 'particular' GROUP BY precio_sesion ORDER BY precio_sesion");
?>
<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
  <h1 class="h3 me-auto mb-0">Pacientes <?= $verBajas ? '(de baja)' : '' ?></h1>
  <a class="btn btn-primary" href="<?= url('paciente', ['id' => 0]) ?>">+ Nuevo paciente</a>
</div>
<form class="d-flex gap-2 mb-3">
  <input type="hidden" name="p" value="pacientes"><?php if ($verBajas): ?><input type="hidden" name="bajas" value="1"><?php endif ?>
  <input class="form-control" name="q" value="<?= e($buscar) ?>" placeholder="Buscar por apellido, nombre o DNI">
  <button class="btn btn-outline-secondary">Buscar</button>
  <a class="btn btn-link text-nowrap" href="<?= url('pacientes', $verBajas ? [] : ['bajas' => 1]) ?>"><?= $verBajas ? 'Ver activos' : 'Ver bajas' ?></a>
</form>

<div class="card"><div class="table-responsive">
<table class="table table-hover mb-0 tabla-compacta">
  <thead><tr><th>Paciente</th><th>Cobertura</th><th class="text-end">Precio</th><th class="d-none d-md-table-cell">Teléfono</th><th class="d-none d-md-table-cell">Última sesión</th></tr></thead>
  <tbody>
  <?php foreach ($pacs as $p): ?>
    <tr onclick="location='<?= url('paciente', ['id' => $p['id']]) ?>'" style="cursor:pointer">
      <td><?= e(nombre_pac($p)) ?></td>
      <td><?= $p['cobertura'] === 'osep' ? '<span class="badge text-bg-info">OSEP</span>' . (!$p['usa_token'] ? ' <span class="badge text-bg-light">sin token</span>' : '') : 'Particular' ?></td>
      <td class="text-end"><?= $p['cobertura'] === 'osep' ? '—' : pesos($p['precio_sesion']) ?></td>
      <td class="d-none d-md-table-cell"><?= e($p['telefono']) ?></td>
      <td class="d-none d-md-table-cell"><?= fecha_ar($p['ultima']) ?></td>
    </tr>
  <?php endforeach ?>
  <?php if (!$pacs): ?><tr><td colspan="5" class="text-muted">Sin resultados.</td></tr><?php endif ?>
  </tbody>
</table>
</div></div>

<?php if ($precios && !$verBajas): ?>
<details class="card mt-4"><summary class="card-header">Aumento de precios (particulares)</summary>
  <form method="post" class="card-body">
    <?= csrf_field() ?><input type="hidden" name="accion" value="aumento">
    <p class="small text-muted">Escribí el precio nuevo para cada grupo (por ejemplo 30 → 35, 35 → 38). Los que dejes igual no cambian. Las sesiones ya pagadas o facturadas conservan su precio.</p>
    <?php foreach ($precios as $pr): ?>
      <div class="input-group mb-2" style="max-width:420px">
        <span class="input-group-text" style="min-width:190px"><?= pesos($pr['precio_sesion']) ?> (<?= $pr['n'] ?> pac.) →</span>
        <input class="form-control" name="nuevo[<?= e($pr['precio_sesion']) ?>]" value="<?= e((float)$pr['precio_sesion']) ?>" inputmode="decimal">
      </div>
    <?php endforeach ?>
    <div class="row g-2 mt-1" style="max-width:420px">
      <div class="col-6"><label class="form-label small">Desde</label><input type="date" class="form-control" name="desde" value="<?= date('Y-m-01', strtotime('first day of next month')) ?>"></div>
      <div class="col-6"><label class="form-label small">Precio para pacientes nuevos</label><input class="form-control" name="precio_nuevos" value="<?= e(ajuste('precio_nuevos')) ?>" inputmode="decimal"></div>
    </div>
    <button class="btn btn-primary mt-3">Aplicar aumento</button>
  </form>
</details>
<?php endif ?>

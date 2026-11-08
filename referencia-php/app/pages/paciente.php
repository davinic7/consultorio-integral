<?php
$id = (int) in('id');
$pac = $id ? row('SELECT * FROM pacientes WHERE ' . pf() . ' AND id = ?', [$id]) : null;
if ($id && !$pac) throw new RuntimeException('Paciente no encontrado');

$CAMPOS = ['apellido', 'nombre', 'dni', 'domicilio', 'ciudad', 'telefono', 'tel_emergencia', 'email', 'fecha_nac', 'estado_civil',
           'ocupacion', 'cobertura', 'nro_afiliado', 'motivo_consulta', 'ciclo_vital'];

if (es_post()) {
    $acc = in('accion');
    if ($acc === 'guardar') {
        $d = [];
        foreach ($CAMPOS as $c) $d[$c] = nulo(in($c));
        if (!$d['apellido'] || !$d['nombre']) throw new RuntimeException('Apellido y nombre son obligatorios');
        $d['cobertura'] = $d['cobertura'] === 'osep' ? 'osep' : 'particular';
        $d['usa_token'] = in('usa_token') ? 1 : 0;
        $d['dni'] = $d['dni'] ? preg_replace('/\D/', '', $d['dni']) : null;
        if ($pac) {
            update('pacientes', $id, $d);
            flash('Datos guardados');
        } else {
            $precio = (float) str_replace(',', '.', in('precio_sesion', ajuste('precio_nuevos', '0')));
            $d += ['precio_sesion' => $precio, 'activo' => 1, 'fecha_alta' => date('Y-m-d')];
            $id = insert('pacientes', $d);
            insert('precios', ['paciente_id' => $id, 'precio' => $precio, 'vigente_desde' => date('Y-m-d')]);
            flash('Paciente creado. Ahora cargale el turno fijo.');
        }
        redir('paciente', ['id' => $id]);
    }
    if (!$pac) redir('pacientes');
    if ($acc === 'turno_add') {
        insert('turnos_fijos', ['paciente_id' => $id, 'dia_semana' => (int) in('dia_semana'), 'hora' => in('hora')]);
        flash('Turno fijo agregado. Usá "Generar turnos" en la agenda para crear las sesiones del mes.');
    } elseif ($acc === 'turno_del') {
        q('DELETE FROM turnos_fijos WHERE ' . pf() . ' AND id = ? AND paciente_id = ?', [(int) in('turno_id'), $id]);
    } elseif ($acc === 'precio') {
        cambiar_precio($id, (float) str_replace(',', '.', in('precio')), in('desde') ?: date('Y-m-d'));
        flash('Precio actualizado');
    } elseif ($acc === 'baja') {
        // Deja de venir: se quita de la agenda futura (no se le reserva el horario)
        update('pacientes', $id, ['activo' => 0, 'fecha_baja' => date('Y-m-d')]);
        q("DELETE FROM sesiones WHERE " . pf() . " AND paciente_id = ? AND fecha > ? AND estado = 'programada'", [$id, date('Y-m-d')]);
        q('DELETE FROM turnos_fijos WHERE ' . pf() . ' AND paciente_id = ?', [$id]);
        flash('Paciente dado de baja. Se liberaron sus turnos futuros.', 'warning');
    } elseif ($acc === 'alta') {
        update('pacientes', $id, ['activo' => 1, 'fecha_baja' => null]);
        flash('Paciente reactivado. Acordate de asignarle un turno.');
    } else {
        procesar_accion_sesion();
    }
    redir('paciente', ['id' => $id]);
}

$v = fn($c) => e($pac[$c] ?? '');
if (!$pac):
    $titulo = 'Nuevo paciente';
else:
    $titulo = nombre_pac($pac);
    $turnos = rows('SELECT * FROM turnos_fijos WHERE ' . pf() . ' AND paciente_id = ? ORDER BY dia_semana, hora', [$id]);
    $sesiones = rows("SELECT s.*, p.apellido, p.nombre, p.cobertura FROM sesiones s JOIN pacientes p ON p.id = s.paciente_id
                      WHERE " . pf('s') . " AND s.paciente_id = ? AND s.fecha >= ? ORDER BY s.fecha DESC", [$id, date('Y-m-01', strtotime('-3 months'))]);
    $notas = rows('SELECT * FROM notas WHERE ' . pf() . ' AND paciente_id = ? ORDER BY fecha DESC, id DESC', [$id]);
    $facturas = rows('SELECT * FROM facturas WHERE ' . pf() . ' AND paciente_id = ? ORDER BY fecha DESC', [$id]);
    $ordenes = rows('SELECT * FROM ordenes_osep WHERE ' . pf() . ' AND paciente_id = ? ORDER BY mes DESC', [$id]);
    $historial = rows('SELECT * FROM precios WHERE ' . pf() . ' AND paciente_id = ? ORDER BY vigente_desde DESC, id DESC', [$id]);
endif;
?>
<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
  <h1 class="h3 me-auto mb-0"><?= e($titulo) ?></h1>
  <?php if ($pac): ?>
    <?php if ($pac['cobertura'] === 'osep'): ?><span class="badge text-bg-info fs-6">OSEP <?= $v('nro_afiliado') ?></span><?php else: ?><span class="badge text-bg-secondary fs-6"><?= pesos($pac['precio_sesion']) ?> / sesión</span><?php endif ?>
    <?php if (!$pac['activo']): ?><span class="badge text-bg-danger">De baja desde <?= fecha_ar($pac['fecha_baja']) ?></span><?php endif ?>
    <a class="btn btn-primary btn-sm" href="<?= url('dictado', ['paciente_id' => $id]) ?>">🎤 Dictar nota</a>
    <?php if ($l = wa_link($pac['telefono'], 'Hola ' . $pac['nombre'] . ', ')): ?><a class="btn btn-success btn-sm" target="_blank" href="<?= e($l) ?>">WhatsApp</a><?php endif ?>
  <?php endif ?>
</div>

<?php if ($pac): ?>
<ul class="nav nav-tabs mb-3" role="tablist">
  <?php foreach (['ses' => 'Sesiones', 'notas' => 'Notas (' . count($notas) . ')', 'datos' => 'Datos', 'fact' => 'Facturas', 'osep' => 'OSEP'] as $k => $t):
    if ($k === 'osep' && $pac['cobertura'] !== 'osep') continue;
    if ($k === 'fact' && $pac['cobertura'] === 'osep' && !$facturas) continue; ?>
    <li class="nav-item"><button class="nav-link <?= $k === 'ses' ? 'active' : '' ?>" data-bs-toggle="tab" data-bs-target="#t-<?= $k ?>" type="button"><?= $t ?></button></li>
  <?php endforeach ?>
</ul>
<div class="tab-content">
<div class="tab-pane fade show active" id="t-ses">
  <div class="card mb-3"><div class="card-body">
    <h2 class="h6">Turno fijo semanal</h2>
    <?php foreach ($turnos as $t): ?>
      <form method="post" class="d-inline"><?= csrf_field() ?><input type="hidden" name="accion" value="turno_del"><input type="hidden" name="turno_id" value="<?= $t['id'] ?>">
        <span class="badge text-bg-primary fs-6 me-1"><?= e(ucfirst(DIAS[$t['dia_semana']])) ?> <?= e($t['hora']) ?> <button class="btn btn-sm p-0 ms-1 text-white" onclick="return confirm('¿Quitar este turno fijo?')">×</button></span>
      </form>
    <?php endforeach ?>
    <?php if (!$turnos): ?><span class="text-muted small">Sin turno fijo.</span><?php endif ?>
    <form method="post" class="row g-2 mt-1"><?= csrf_field() ?><input type="hidden" name="accion" value="turno_add">
      <div class="col-6 col-md-3"><select class="form-select form-select-sm" name="dia_semana">
        <?php foreach (array_map('intval', explode(',', ajuste('dias_atencion', '2,3,4'))) as $d): ?><option value="<?= $d ?>"><?= e(ucfirst(DIAS[$d])) ?></option><?php endforeach ?></select></div>
      <div class="col-4 col-md-2"><input type="time" class="form-control form-control-sm" name="hora" required></div>
      <div class="col-2 col-md-2"><button class="btn btn-sm btn-outline-primary">Agregar</button></div>
    </form>
  </div></div>
  <h2 class="h6">Últimos 3 meses</h2>
  <?php foreach ($sesiones as $s) echo fila_sesion($s, false, true); ?>
  <?php if (!$sesiones): ?><p class="text-muted">Sin sesiones.</p><?php endif ?>
  <details class="mt-2"><summary class="small">+ Agregar sesión</summary>
    <form method="post" class="row g-2 mt-1"><?= csrf_field() ?><input type="hidden" name="accion" value="nueva_sesion"><input type="hidden" name="paciente_id" value="<?= $id ?>">
      <div class="col-5 col-md-3"><input type="date" class="form-control form-control-sm" name="fecha" value="<?= date('Y-m-d') ?>" required></div>
      <div class="col-4 col-md-2"><input type="time" class="form-control form-control-sm" name="hora"></div>
      <div class="col-3 col-md-2"><button class="btn btn-sm btn-primary">Agregar</button></div>
    </form>
  </details>
</div>

<div class="tab-pane fade" id="t-notas">
  <?php foreach ($notas as $n): ?>
    <div class="card mb-2"><div class="card-body py-2">
      <div class="small text-muted mb-1"><?= fecha_ar($n['fecha']) ?> · <?= $n['tipo'] === 'historia' ? '<b>Historia clínica inicial</b>' : 'Nota de sesión' ?></div>
      <div class="nota"><?= e(descifrar($n['contenido'])) ?></div>
    </div></div>
  <?php endforeach ?>
  <?php if (!$notas): ?><p class="text-muted">Todavía no hay notas. Usá "Dictar nota" al terminar la sesión.</p><?php endif ?>
</div>

<div class="tab-pane fade" id="t-fact">
  <?php foreach ($facturas as $f): ?>
    <div class="d-flex flex-wrap gap-2 align-items-center border-bottom py-2">
      <span class="me-auto">Factura C <?= str_pad((string)$f['pto_vta'], 5, '0', STR_PAD_LEFT) ?>-<?= str_pad((string)$f['numero'], 8, '0', STR_PAD_LEFT) ?> · <?= mes_nombre($f['periodo']) ?> · <?= pesos($f['total']) ?>
        <?= $f['modo'] !== 'produccion' ? '<span class="badge text-bg-warning">' . e($f['modo']) . '</span>' : '' ?></span>
      <?php if ($f['pdf']): ?><a class="btn btn-sm btn-outline-secondary" target="_blank" href="<?= url('archivo', ['f' => $f['pdf']]) ?>">PDF</a><?php endif ?>
    </div>
  <?php endforeach ?>
  <?php if (!$facturas): ?><p class="text-muted">Sin facturas.</p><?php endif ?>
  <h2 class="h6 mt-4">Historial de precio</h2>
  <ul class="small"><?php foreach ($historial as $h): ?><li><?= pesos($h['precio']) ?> desde <?= fecha_ar($h['vigente_desde']) ?></li><?php endforeach ?></ul>
  <form method="post" class="row g-2" style="max-width:480px"><?= csrf_field() ?><input type="hidden" name="accion" value="precio">
    <div class="col-5"><input class="form-control form-control-sm" name="precio" placeholder="Nuevo precio" inputmode="decimal" required></div>
    <div class="col-4"><input type="date" class="form-control form-control-sm" name="desde" value="<?= date('Y-m-d') ?>"></div>
    <div class="col-3"><button class="btn btn-sm btn-outline-primary">Cambiar</button></div>
  </form>
</div>

<?php if ($pac['cobertura'] === 'osep'): ?>
<div class="tab-pane fade" id="t-osep">
  <?php foreach ($ordenes as $o): ?>
    <div class="border-bottom py-2"><a href="<?= url('orden', ['id' => $o['id']]) ?>"><?= mes_nombre($o['mes']) ?></a> · Aut. <?= e($o['nro_autorizacion']) ?> · <?= (int)$o['cantidad'] ?> sesiones · compra <?= fecha_ar($o['fecha_compra']) ?></div>
  <?php endforeach ?>
  <a class="btn btn-sm btn-primary mt-2" href="<?= url('orden', ['id' => 0, 'paciente_id' => $id]) ?>">+ Registrar orden</a>
</div>
<?php endif ?>

<div class="tab-pane fade" id="t-datos">
<?php endif ?>

<form method="post" class="card card-body">
  <?= csrf_field() ?><input type="hidden" name="accion" value="guardar">
  <div class="row g-2">
    <div class="col-md-6"><label class="form-label small">Apellido *</label><input class="form-control" name="apellido" value="<?= $v('apellido') ?>" required></div>
    <div class="col-md-6"><label class="form-label small">Nombre *</label><input class="form-control" name="nombre" value="<?= $v('nombre') ?>" required></div>
    <div class="col-6 col-md-3"><label class="form-label small">DNI (para facturar)</label><input class="form-control" name="dni" value="<?= $v('dni') ?>" inputmode="numeric"></div>
    <div class="col-6 col-md-3"><label class="form-label small">Fecha de nacimiento</label><input type="date" class="form-control" name="fecha_nac" value="<?= $v('fecha_nac') ?>"></div>
    <div class="col-md-6"><label class="form-label small">Domicilio (para facturar)</label><input class="form-control" name="domicilio" value="<?= $v('domicilio') ?>"></div>
    <div class="col-6 col-md-3"><label class="form-label small">Ciudad</label><input class="form-control" name="ciudad" value="<?= $v('ciudad') ?>"></div>
    <div class="col-6 col-md-3"><label class="form-label small">Teléfono (WhatsApp)</label><input class="form-control" name="telefono" value="<?= $v('telefono') ?>" inputmode="tel"></div>
    <div class="col-md-6"><label class="form-label small">Contacto de emergencia</label><input class="form-control" name="tel_emergencia" value="<?= $v('tel_emergencia') ?>"></div>
    <div class="col-6 col-md-3"><label class="form-label small">Estado civil</label><input class="form-control" name="estado_civil" value="<?= $v('estado_civil') ?>"></div>
    <div class="col-6 col-md-3"><label class="form-label small">Ocupación</label><input class="form-control" name="ocupacion" value="<?= $v('ocupacion') ?>"></div>
    <div class="col-md-6"><label class="form-label small">Email</label><input type="email" class="form-control" name="email" value="<?= $v('email') ?>"></div>
    <div class="col-6 col-md-3"><label class="form-label small">Cobertura</label>
      <select class="form-select" name="cobertura" onchange="document.getElementById('osepCampos').hidden = this.value !== 'osep'">
        <option value="particular">Particular</option><option value="osep" <?= ($pac['cobertura'] ?? '') === 'osep' ? 'selected' : '' ?>>OSEP</option></select></div>
    <?php if (!$pac): ?><div class="col-6 col-md-3"><label class="form-label small">Precio por sesión</label><input class="form-control" name="precio_sesion" value="<?= e(ajuste('precio_nuevos')) ?>" inputmode="decimal"></div><?php endif ?>
    <div class="col-12 row g-2" id="osepCampos" <?= ($pac['cobertura'] ?? '') === 'osep' ? '' : 'hidden' ?>>
      <div class="col-6 col-md-3"><label class="form-label small">N° afiliado OSEP</label><input class="form-control" name="nro_afiliado" value="<?= $v('nro_afiliado') ?>"></div>
      <div class="col-6 col-md-4 d-flex align-items-end"><div class="form-check"><input class="form-check-input" type="checkbox" name="usa_token" value="1" id="tok" <?= ($pac['usa_token'] ?? 1) ? 'checked' : '' ?>><label class="form-check-label small" for="tok">Usa token (desmarcar para mayores: planilla en papel)</label></div></div>
    </div>
    <div class="col-md-6"><label class="form-label small">Motivo de consulta / descripción</label><textarea class="form-control" name="motivo_consulta" rows="2"><?= $v('motivo_consulta') ?></textarea></div>
    <div class="col-md-6"><label class="form-label small">Ciclo vital</label><input class="form-control" name="ciclo_vital" value="<?= $v('ciclo_vital') ?>"></div>
  </div>
  <div class="mt-3"><button class="btn btn-primary">Guardar</button></div>
</form>

<?php if ($pac): ?>
  <form method="post" class="mt-3"><?= csrf_field() ?>
    <?php if ($pac['activo']): ?><input type="hidden" name="accion" value="baja"><button class="btn btn-outline-danger btn-sm" onclick="return confirm('Dar de baja: se liberan sus turnos futuros. Las notas y facturas se conservan. ¿Continuar?')">Dar de baja (dejó de venir)</button>
    <?php else: ?><input type="hidden" name="accion" value="alta"><button class="btn btn-outline-success btn-sm">Reactivar paciente</button><?php endif ?>
  </form>
</div></div>
<?php endif ?>

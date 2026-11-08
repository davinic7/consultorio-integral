<?php
/** Acciones de sesión (POST desde agenda, inicio o ficha). Devuelve true si procesó algo. */
function procesar_accion_sesion(): bool {
    $acc = in('accion');
    if (!in_array($acc, ['estado', 'pago', 'nueva_sesion', 'borrar_sesion'], true)) return false;
    if ($acc === 'nueva_sesion') {
        $pid = (int) in('paciente_id');
        $pac = paciente_propio($pid);
        insert('sesiones', ['paciente_id' => $pid, 'fecha' => in('fecha'), 'hora' => nulo(in('hora')), 'estado' => in('estado', 'programada'),
            'precio' => $pac['cobertura'] === 'osep' ? 0 : precio_vigente($pid, in('fecha'))]);
        flash('Sesión agregada');
        return true;
    }
    $s = row('SELECT * FROM sesiones WHERE ' . pf() . ' AND id = ?', [(int) in('sesion_id')]);
    if (!$s) throw new RuntimeException('Sesión inexistente');
    if ($s['factura_id'] && $acc !== 'estado') { flash('Esa sesión ya está facturada', 'warning'); return true; }
    if ($acc === 'estado') {
        $est = in('estado');
        if (!isset(ESTADOS[$est])) throw new RuntimeException('Estado inválido');
        $d = ['estado' => $est];
        if (!es_cobrable($est)) { $d['pagado'] = 0; $d['medio_pago'] = null; }
        update('sesiones', (int)$s['id'], $d);
    } elseif ($acc === 'pago') {
        $medio = in('medio');
        update('sesiones', (int)$s['id'], $medio === 'ninguno' ? ['pagado' => 0, 'medio_pago' => null] : ['pagado' => 1, 'medio_pago' => $medio === 'efectivo' ? 'efectivo' : 'transferencia']);
    } elseif ($acc === 'borrar_sesion') {
        if ($s['factura_id'] || $s['cargada_osep']) { flash('No se puede borrar: ya está facturada o cargada en OSEP', 'warning'); return true; }
        q('UPDATE notas SET sesion_id = NULL WHERE ' . pf() . ' AND sesion_id = ?', [$s['id']]); // las notas se conservan
        q('DELETE FROM sesiones WHERE ' . pf() . ' AND id = ?', [$s['id']]);
    }
    return true;
}

/** Fila de sesión con botones rápidos de estado y pago. $s debe traer apellido, nombre, cobertura. */
function fila_sesion(array $s, bool $mostrarPaciente = true, bool $mostrarFecha = false): string {
    ob_start(); ?>
<div class="card mb-2 ses-<?= e($s['estado']) ?>">
  <div class="card-body py-2 px-3">
    <div class="d-flex flex-wrap align-items-center gap-2">
      <div class="me-auto">
        <?php if ($mostrarFecha): ?><span class="text-muted small"><?= e(DIAS[(int)date('N', strtotime($s['fecha']))]) ?> <?= fecha_ar($s['fecha']) ?></span><?php endif ?>
        <b><?= e($s['hora'] ?? '') ?></b>
        <?php if ($mostrarPaciente): ?><a href="<?= url('paciente', ['id' => $s['paciente_id']]) ?>" class="text-decoration-none"><?= e(nombre_pac($s)) ?></a><?php endif ?>
        <?php if (($s['cobertura'] ?? '') === 'osep'): ?><span class="badge text-bg-info">OSEP</span><?php endif ?>
        <span class="badge text-bg-<?= ESTADOS[$s['estado']][1] ?>"><?= e(ESTADOS[$s['estado']][0]) ?></span>
        <?php if ($s['pagado']): ?><span class="badge text-bg-success">Pagó <?= e($s['medio_pago']) ?></span><?php endif ?>
        <?php if ($s['factura_id']): ?><span class="badge text-bg-dark">Facturada</span><?php endif ?>
      </div>
      <form method="post" class="d-flex flex-wrap gap-1 estado-btns">
        <?= csrf_field() ?><input type="hidden" name="sesion_id" value="<?= $s['id'] ?>"><input type="hidden" name="accion" value="estado">
        <button name="estado" value="asistio" class="btn btn-sm btn-outline-success" title="Asistió">✔</button>
        <button name="estado" value="ausente_tarde" class="btn btn-sm btn-outline-warning" title="No vino, avisó tarde (cobra)">✘$</button>
        <button name="estado" value="ausente_aviso" class="btn btn-sm btn-outline-secondary" title="No vino, avisó con tiempo">✘</button>
      </form>
      <?php if (($s['cobertura'] ?? '') !== 'osep' && es_cobrable($s['estado']) && !$s['factura_id']): ?>
      <form method="post" class="d-flex gap-1">
        <?= csrf_field() ?><input type="hidden" name="sesion_id" value="<?= $s['id'] ?>"><input type="hidden" name="accion" value="pago">
        <button name="medio" value="efectivo" class="btn btn-sm <?= $s['medio_pago'] === 'efectivo' ? 'btn-success' : 'btn-outline-success' ?>" title="Pagó en efectivo">$ Efvo</button>
        <button name="medio" value="transferencia" class="btn btn-sm <?= $s['medio_pago'] === 'transferencia' ? 'btn-success' : 'btn-outline-success' ?>" title="Pagó por transferencia">$ Transf</button>
        <?php if ($s['pagado']): ?><button name="medio" value="ninguno" class="btn btn-sm btn-outline-danger" title="Marcar impago">↺</button><?php endif ?>
      </form>
      <?php endif ?>
      <a class="btn btn-sm btn-outline-primary" href="<?= url('dictado', ['sesion_id' => $s['id']]) ?>" title="Dictar nota">🎤</a>
    </div>
  </div>
</div>
<?php return ob_get_clean();
}

function select_pacientes(string $name = 'paciente_id', ?int $sel = null, bool $soloActivos = true): string {
    $ps = rows('SELECT id, apellido, nombre, cobertura FROM pacientes WHERE ' . pf() . ($soloActivos ? ' AND activo = 1' : '') . ' ORDER BY apellido, nombre');
    $h = '<select class="form-select" name="' . e($name) . '" required><option value="">Elegir paciente…</option>';
    foreach ($ps as $p) $h .= '<option value="' . $p['id'] . '"' . ($sel === (int)$p['id'] ? ' selected' : '') . '>' . e(nombre_pac($p)) . ($p['cobertura'] === 'osep' ? ' (OSEP)' : '') . '</option>';
    return $h . '</select>';
}

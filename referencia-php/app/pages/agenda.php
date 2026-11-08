<?php
$titulo = 'Agenda';
$lunes = in('semana') ?: date('Y-m-d', strtotime('monday this week'));
$lunes = date('Y-m-d', strtotime('monday this week', strtotime($lunes)));
$pend = (bool) in('pendientes');
$volver = $pend ? ['pendientes' => 1] : ['semana' => $lunes];

if (es_post()) {
    if (in('accion') === 'generar') { $n = generar_agenda(in('mes')); flash("Se agregaron $n turnos a " . mes_nombre(in('mes'))); redir('agenda', $volver); }
    if (procesar_accion_sesion()) redir('agenda', $volver);
}

if ($pend) {
    $ses = rows("SELECT s.*, p.apellido, p.nombre, p.cobertura FROM sesiones s JOIN pacientes p ON p.id = s.paciente_id
                 WHERE " . pf('s') . " AND s.estado = 'programada' AND s.fecha < ? ORDER BY s.fecha, s.hora", [date('Y-m-d')]);
} else {
    $dom = date('Y-m-d', strtotime("$lunes +6 days"));
    $ses = rows("SELECT s.*, p.apellido, p.nombre, p.cobertura FROM sesiones s JOIN pacientes p ON p.id = s.paciente_id
                 WHERE " . pf('s') . " AND s.fecha BETWEEN ? AND ? ORDER BY s.fecha, s.hora", [$lunes, $dom]);
}
$porDia = [];
foreach ($ses as $s) $porDia[$s['fecha']][] = $s;
$mesSemana = substr($lunes, 0, 7);
?>
<div class="d-flex flex-wrap align-items-center gap-2 mb-3">
  <h1 class="h3 me-auto mb-0"><?= $pend ? 'Sesiones sin marcar' : 'Semana del ' . fecha_ar($lunes) ?></h1>
  <?php if (!$pend): ?>
  <a class="btn btn-outline-secondary btn-sm" href="<?= url('agenda', ['semana' => date('Y-m-d', strtotime("$lunes -7 days"))]) ?>">‹ Anterior</a>
  <a class="btn btn-outline-secondary btn-sm" href="<?= url('agenda') ?>">Hoy</a>
  <a class="btn btn-outline-secondary btn-sm" href="<?= url('agenda', ['semana' => date('Y-m-d', strtotime("$lunes +7 days"))]) ?>">Siguiente ›</a>
  <form method="post" class="d-inline"><?= csrf_field() ?><input type="hidden" name="accion" value="generar"><input type="hidden" name="mes" value="<?= $mesSemana ?>">
    <button class="btn btn-sm btn-outline-primary" title="Crea los turnos fijos del mes que falten">Generar turnos de <?= MESES[(int)substr($mesSemana, 5)] ?></button></form>
  <?php else: ?><a class="btn btn-outline-secondary btn-sm" href="<?= url('agenda') ?>">Volver a la semana</a><?php endif ?>
</div>

<?php if (!$porDia): ?><p class="text-muted"><?= $pend ? 'No hay sesiones pendientes de marcar. 👍' : 'No hay turnos esta semana.' ?></p><?php endif ?>
<?php foreach ($porDia as $f => $lista): ?>
  <h2 class="h6 mt-3 text-uppercase text-muted"><?= e(DIAS[(int)date('N', strtotime($f))]) ?> <?= fecha_ar($f) ?></h2>
  <?php foreach ($lista as $s) echo fila_sesion($s); ?>
<?php endforeach ?>

<details class="card mt-4"><summary class="card-header">+ Agregar sesión suelta</summary>
  <form method="post" class="card-body row g-2">
    <?= csrf_field() ?><input type="hidden" name="accion" value="nueva_sesion">
    <div class="col-md-5"><?= select_pacientes() ?></div>
    <div class="col-6 col-md-3"><input type="date" class="form-control" name="fecha" value="<?= date('Y-m-d') ?>" required></div>
    <div class="col-6 col-md-2"><input type="time" class="form-control" name="hora"></div>
    <div class="col-md-2"><button class="btn btn-primary w-100">Agregar</button></div>
  </form>
</details>

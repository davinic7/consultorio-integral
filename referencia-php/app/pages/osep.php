<?php
$titulo = 'OSEP';
$mes = preg_match('/^\d{4}-\d{2}$/', (string) in('mes')) ? in('mes') : date('Y-m');
[$ini, $fin] = mes_rango($mes);
$pacs = rows("SELECT p.*,
   (SELECT COUNT(*) FROM sesiones s WHERE s.paciente_id = p.id AND s.fecha BETWEEN ? AND ? AND s.estado = 'asistio') AS asistidas,
   (SELECT COUNT(*) FROM sesiones s WHERE s.paciente_id = p.id AND s.fecha BETWEEN ? AND ? AND s.estado = 'asistio' AND s.cargada_osep = 1) AS cargadas,
   (SELECT COUNT(*) FROM sesiones s WHERE s.paciente_id = p.id AND s.fecha BETWEEN ? AND ?) AS turnos
   FROM pacientes p WHERE " . pf('p') . " AND p.cobertura = 'osep' AND (p.activo = 1 OR EXISTS (SELECT 1 FROM ordenes_osep o WHERE o.paciente_id = p.id AND o.mes = ?))
   ORDER BY p.apellido, p.nombre", [$ini, $fin, $ini, $fin, $ini, $fin, $mes]);
$ordenes = [];
foreach (rows('SELECT * FROM ordenes_osep WHERE ' . pf() . ' AND mes = ?', [$mes]) as $o) $ordenes[$o['paciente_id']][] = $o;
$nomMes = MESES[(int)substr($mes, 5)];
?>
<div class="d-flex flex-wrap align-items-center gap-2 mb-2">
  <h1 class="h3 me-auto mb-0">OSEP · <?= mes_nombre($mes) ?></h1>
  <a class="btn btn-sm btn-outline-secondary" href="<?= url('osep', ['mes' => mes_anterior($mes)]) ?>">‹</a>
  <a class="btn btn-sm btn-outline-secondary" href="<?= url('osep', ['mes' => date('Y-m', strtotime("$mes-01 +1 month"))]) ?>">›</a>
  <a class="btn btn-sm btn-primary" href="<?= url('tokens', ['mes' => $mes]) ?>">📷 Cargar tokens desde capturas</a>
  <?php if ($sia = ajuste('osep_url')): ?><a class="btn btn-sm btn-info" target="_blank" href="<?= e($sia) ?>">Abrir SIA OSEP</a><?php endif ?>
</div>
<p class="small text-muted">Las sesiones de <?= $nomMes ?> tienen que quedar cargadas en el SIA dentro de <?= $nomMes ?>. Reglas: una por día, desde la fecha de compra de la orden, hasta <?= e(ajuste('osep_max_semana', '3')) ?> por semana.</p>

<div class="row g-2">
<?php foreach ($pacs as $p):
    $ords = $ordenes[$p['id']] ?? [];
    $falta = (int)$p['asistidas'] - (int)$p['cargadas'];
    $pedirOrden = wa_link($p['telefono'], "Hola {$p['nombre']}, te paso el pedido para las sesiones de $nomMes. Cuando compres la orden en OSEP, mandame una foto por favor. ¡Gracias!");
    $fechas = array_column(rows("SELECT fecha FROM sesiones WHERE " . pf() . " AND paciente_id = ? AND fecha BETWEEN ? AND ? AND estado = 'asistio' ORDER BY fecha", [$p['id'], $ini, $fin]), 'fecha');
    $pedirTokens = $p['usa_token'] ? wa_link($p['telefono'], "Hola {$p['nombre']}, ¿me pasás los tokens de OSEP? Son " . count($fechas) . " sesiones de $nomMes (" . implode(', ', array_map(fn($f) => date('j/n', strtotime($f)), $fechas)) . "). ¡Gracias!") : null; ?>
  <div class="col-md-6"><div class="card h-100"><div class="card-body">
    <div class="d-flex align-items-start">
      <div class="me-auto"><a class="fw-bold text-decoration-none" href="<?= url('paciente', ['id' => $p['id']]) ?>"><?= e(nombre_pac($p)) ?></a>
        <div class="small text-muted">Afiliado <span class="copiable" data-copiar="<?= e($p['nro_afiliado']) ?>"><?= e($p['nro_afiliado'] ?: '—') ?></span> <?= !$p['usa_token'] ? '· <b>sin token (planilla)</b>' : '' ?></div></div>
      <?php if ($ords && $p['asistidas'] && !$falta): ?><span class="badge text-bg-success">Todo cargado</span>
      <?php elseif (!$ords): ?><span class="badge text-bg-warning">Sin orden</span>
      <?php else: ?><span class="badge text-bg-primary"><?= $p['cargadas'] ?>/<?= $p['asistidas'] ?> cargadas</span><?php endif ?>
    </div>
    <div class="small mt-1"><?= $p['asistidas'] ?> asistidas de <?= $p['turnos'] ?> turnos</div>
    <?php foreach ($ords as $o): ?>
      <div class="small">Orden <span class="copiable" data-copiar="<?= e($o['nro_autorizacion']) ?>"><?= e($o['nro_autorizacion']) ?></span> · <?= (int)$o['cantidad'] ?> ses. · compra <?= fecha_ar($o['fecha_compra']) ?></div>
    <?php endforeach ?>
    <div class="d-flex flex-wrap gap-1 mt-2">
      <?php if ($ords): ?><a class="btn btn-sm btn-primary" href="<?= url('orden', ['id' => $ords[0]['id']]) ?>">Asistente de carga</a>
      <?php else: ?><a class="btn btn-sm btn-primary" href="<?= url('orden', ['id' => 0, 'paciente_id' => $p['id'], 'mes' => $mes]) ?>">Registrar orden</a><?php endif ?>
      <?php if (!$ords && $pedirOrden): ?><a class="btn btn-sm btn-outline-success" target="_blank" href="<?= e($pedirOrden) ?>">Pedir orden</a><?php endif ?>
      <?php if ($ords && $falta && $pedirTokens): ?><a class="btn btn-sm btn-outline-success" target="_blank" href="<?= e($pedirTokens) ?>">Pedir tokens</a><?php endif ?>
    </div>
  </div></div></div>
<?php endforeach ?>
<?php if (!$pacs): ?><p class="text-muted">No hay pacientes de OSEP activos.</p><?php endif ?>
</div>

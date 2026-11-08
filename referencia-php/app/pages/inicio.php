<?php
$titulo = 'Hoy';
sincronizar_precios();
if (es_post()) {
    if (in('accion') === 'generar') { $n = generar_agenda(in('mes')); flash("Se agregaron $n turnos a la agenda de " . mes_nombre(in('mes'))); redir('inicio'); }
    if (procesar_accion_sesion()) redir('inicio');
}
$hoy = date('Y-m-d');
$mes = date('Y-m');
$ant = mes_anterior();
$sesHoy = rows("SELECT s.*, p.apellido, p.nombre, p.cobertura FROM sesiones s JOIN pacientes p ON p.id = s.paciente_id WHERE " . pf('s') . " AND s.fecha = ? ORDER BY s.hora", [$hoy]);

// Tareas pendientes
$tareas = [];
$sinMarcar = (int) val("SELECT COUNT(*) FROM sesiones WHERE " . pf() . " AND estado = 'programada' AND fecha < ?", [$hoy]);
if ($sinMarcar) $tareas[] = ['warning', "Hay <b>$sinMarcar</b> sesiones pasadas sin marcar (asistió / no vino).", url('agenda', ['pendientes' => 1]), 'Marcarlas'];

$turnosMes = (int) val('SELECT COUNT(*) FROM sesiones WHERE ' . pf() . ' AND fecha BETWEEN ? AND ?', mes_rango($mes));
$hayFijos = (int) val('SELECT COUNT(*) FROM turnos_fijos WHERE ' . pf());
if ($hayFijos && !$turnosMes) $tareas[] = ['info', 'Todavía no generaste la agenda de ' . mes_nombre($mes) . '.', null, 'generar'];

$facturar = array_filter(resumen_facturacion($ant), fn($r) => $r['cantidad'] > 0);
if ($facturar) $tareas[] = ['primary', 'Facturar ' . mes_nombre($ant) . ': <b>' . count($facturar) . '</b> pacientes particulares con sesiones pagas sin factura.', url('facturacion', ['mes' => $ant]), 'Ir a facturar'];

$osepSinOrden = rows("SELECT DISTINCT p.id, p.apellido, p.nombre FROM sesiones s JOIN pacientes p ON p.id = s.paciente_id
    WHERE " . pf('s') . " AND p.cobertura = 'osep' AND s.fecha BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM ordenes_osep o WHERE o.paciente_id = p.id AND o.mes = ?)",
    array_merge(mes_rango($mes), [$mes]));
if ($osepSinOrden) $tareas[] = ['info', 'OSEP: falta registrar la orden de ' . mes_nombre($mes) . ' de <b>' . count($osepSinOrden) . '</b> pacientes.', url('osep', ['mes' => $mes]), 'Ver OSEP'];

$sinCargar = (int) val("SELECT COUNT(*) FROM sesiones s JOIN pacientes p ON p.id = s.paciente_id WHERE " . pf('s') . " AND p.cobertura = 'osep' AND s.estado = 'asistio' AND s.cargada_osep = 0 AND s.fecha BETWEEN ? AND ?", mes_rango($mes));
$diasFin = (int) date('t') - (int) date('j');
if ($sinCargar && $diasFin <= 7) $tareas[] = ['danger', "OSEP: quedan <b>$diasFin días</b> del mes y hay <b>$sinCargar</b> sesiones sin cargar en el SIA.", url('osep', ['mes' => $mes]), 'Cargar'];
?>
<h1 class="h3">Hola<?= isset($_SESSION['nombre']) ? ', ' . e(explode(' ', $_SESSION['nombre'])[0]) : '' ?></h1>
<p class="text-muted"><?= e(ucfirst(DIAS[(int)date('N')])) ?> <?= date('j') ?> de <?= MESES[(int)date('n')] ?></p>

<?php foreach ($tareas as [$tipo, $msg, $link, $btn]): ?>
  <div class="alert alert-<?= $tipo ?> d-flex align-items-center gap-2">
    <div class="me-auto"><?= $msg ?></div>
    <?php if ($btn === 'generar'): ?>
      <form method="post"><?= csrf_field() ?><input type="hidden" name="accion" value="generar"><input type="hidden" name="mes" value="<?= $mes ?>"><button class="btn btn-sm btn-primary">Generar</button></form>
    <?php elseif ($link): ?><a class="btn btn-sm btn-outline-dark" href="<?= $link ?>"><?= $btn ?></a><?php endif ?>
  </div>
<?php endforeach ?>

<h2 class="h5 mt-3">Turnos de hoy</h2>
<?php if (!$sesHoy): ?><p class="text-muted">No hay turnos cargados para hoy.</p><?php endif ?>
<?php foreach ($sesHoy as $s) echo fila_sesion($s); ?>

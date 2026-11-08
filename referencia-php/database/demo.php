<?php
// Datos de ejemplo (ficticios) para probar: se cargan con --demo
if (val('SELECT COUNT(*) FROM pacientes WHERE ' . pf())) { echo "Ya hay pacientes, no se cargan datos de ejemplo\n"; return; }
guardar_ajuste('profesional', 'Lic. Laura Ejemplo');
guardar_ajuste('dias_atencion', '2,3,4');
guardar_ajuste('precio_nuevos', '40000');
guardar_ajuste('matricula', 'MP-000');
guardar_ajuste('razon_social', 'EJEMPLO LAURA');
guardar_ajuste('cuit', '27-00000000-0');
guardar_ajuste('domicilio_fiscal', 'Calle Falsa 123 - San Fernando del Valle de Catamarca');
guardar_ajuste('inicio_actividades', '01/03/2020');

$demo = [
    ['Pérez', 'Lucía', '30111222', 'Rivadavia 100', '3834111111', 'particular', 30000, [[2, '15:00']]],
    ['Gómez', 'Martín', '32111333', 'Sarmiento 450', '3834222222', 'particular', 35000, [[2, '16:00'], [4, '16:00']]],
    ['Díaz', 'Carla', '35111444', 'Mota Botello 77', '3834333333', 'particular', 35000, [[3, '17:00']]],
    ['Romero', 'Ana', '40111555', 'Av. Belgrano 1200', '3834444444', 'particular', 40000, [[4, '18:00']]],
    ['Herrera', 'Jorge', '20111666', 'Junín 300', '3834555555', 'osep', 0, [[2, '19:00'], [4, '19:00']]],
    ['Castro', 'Elsa', '10111777', 'Chacabuco 50', '3834666666', 'osep', 0, [[3, '15:00']]],
];
$hoy = date('Y-m-d');
$mesAnt = mes_anterior();
foreach ($demo as $i => [$ap, $no, $dni, $dom, $tel, $cob, $precio, $turnos]) {
    $id = insert('pacientes', ['apellido' => $ap, 'nombre' => $no, 'dni' => $dni, 'domicilio' => $dom, 'ciudad' => 'Catamarca', 'telefono' => $tel,
        'cobertura' => $cob, 'nro_afiliado' => $cob === 'osep' ? '1234567' . $i . '01' : null, 'usa_token' => $ap === 'Castro' ? 0 : 1,
        'fecha_nac' => $ap === 'Castro' ? '1950-05-10' : '1990-01-01', 'precio_sesion' => $precio, 'activo' => 1, 'fecha_alta' => date('Y-m-d', strtotime('-1 year'))]);
    insert('precios', ['paciente_id' => $id, 'precio' => $precio, 'vigente_desde' => date('Y-m-d', strtotime('-1 year'))]);
    foreach ($turnos as [$d, $h]) insert('turnos_fijos', ['paciente_id' => $id, 'dia_semana' => $d, 'hora' => $h]);
}
generar_agenda($mesAnt);
generar_agenda(date('Y-m'));
// Mes anterior: casi todo asistido y pagado; algunos casos especiales
$k = 0;
foreach (rows("SELECT s.id, p.cobertura FROM sesiones s JOIN pacientes p ON p.id = s.paciente_id WHERE " . pf('s') . " AND s.fecha BETWEEN ? AND ? ORDER BY s.fecha", mes_rango($mesAnt)) as $s) {
    $k++;
    $estado = $k % 9 === 0 ? 'ausente_aviso' : ($k % 11 === 0 ? 'ausente_tarde' : 'asistio');
    $d = ['estado' => $estado];
    if ($s['cobertura'] === 'particular' && es_cobrable($estado)) $d += ['pagado' => 1, 'medio_pago' => $k % 3 ? 'transferencia' : 'efectivo'];
    update('sesiones', (int)$s['id'], $d);
}
// Mes actual: lo que ya pasó, asistido
foreach (rows("SELECT id FROM sesiones WHERE " . pf() . " AND fecha >= ? AND fecha < ?", [date('Y-m-01'), $hoy]) as $s) update('sesiones', (int)$s['id'], ['estado' => 'asistio']);
// Orden OSEP del mes actual para Herrera
$her = (int) val("SELECT id FROM pacientes WHERE " . pf() . " AND apellido = 'Herrera'");
insert('ordenes_osep', ['paciente_id' => $her, 'nro_autorizacion' => '1290045871', 'fecha_compra' => date('Y-m-04'), 'cantidad' => 8, 'mes' => date('Y-m'), 'creado' => date('Y-m-d H:i:s')]);
echo "✓ Datos de ejemplo cargados (usuario: demo / demo1234)\n";

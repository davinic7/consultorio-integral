<?php
// Reglas del consultorio (salen del relevamiento)

const ESTADOS = [
    'programada'    => ['Programada', 'secondary', '·'],
    'asistio'       => ['Asistió', 'success', '✔'],
    'ausente_tarde' => ['No vino (avisó tarde: cobra)', 'warning', '✘$'],
    'ausente_aviso' => ['No vino (avisó con tiempo)', 'light', '✘'],
    'cancelada'     => ['Cancelada por mí', 'light', '—'],
];

/** Particulares: se cobra si asistió o si faltó sin avisar con 24 h. */
function es_cobrable(string $estado): bool { return in_array($estado, ['asistio', 'ausente_tarde'], true); }

function precio_vigente(int $paciente_id, ?string $fecha = null): float {
    $fecha ??= date('Y-m-d');
    $p = val('SELECT precio FROM precios WHERE ' . pf() . ' AND paciente_id = ? AND vigente_desde <= ? ORDER BY vigente_desde DESC, id DESC LIMIT 1', [$paciente_id, $fecha]);
    return $p !== null ? (float)$p : (float) val('SELECT precio_sesion FROM pacientes WHERE ' . pf() . ' AND id = ?', [$paciente_id]);
}

function cambiar_precio(int $paciente_id, float $precio, string $desde): void {
    insert('precios', ['paciente_id' => $paciente_id, 'precio' => $precio, 'vigente_desde' => $desde]);
    if ($desde <= date('Y-m-d')) q('UPDATE pacientes SET precio_sesion = ? WHERE ' . pf() . ' AND id = ?', [$precio, $paciente_id]);
    // sesiones futuras sin pagar toman el precio nuevo
    q("UPDATE sesiones SET precio = ? WHERE " . pf() . " AND paciente_id = ? AND fecha >= ? AND pagado = 0 AND factura_id IS NULL", [$precio, $paciente_id, $desde]);
}

/** Crea las sesiones "programadas" del mes a partir de los turnos fijos (no duplica). */
function generar_agenda(string $ym): int {
    [$ini, $fin] = mes_rango($ym);
    $n = 0;
    $turnos = rows("SELECT t.*, p.cobertura FROM turnos_fijos t JOIN pacientes p ON p.id = t.paciente_id WHERE " . pf('t') . " AND p.activo = 1");
    for ($d = strtotime($ini); $d <= strtotime($fin); $d += 86400) {
        $f = date('Y-m-d', $d); $dow = (int) date('N', $d);
        foreach ($turnos as $t) {
            if ((int)$t['dia_semana'] !== $dow) continue;
            if (val('SELECT COUNT(*) FROM sesiones WHERE ' . pf() . ' AND paciente_id = ? AND fecha = ?', [$t['paciente_id'], $f])) continue;
            insert('sesiones', ['paciente_id' => $t['paciente_id'], 'fecha' => $f, 'hora' => $t['hora'],
                'estado' => 'programada', 'precio' => $t['cobertura'] === 'osep' ? 0 : precio_vigente((int)$t['paciente_id'], $f)]);
            $n++;
        }
    }
    return $n;
}

/** Resumen de facturación de particulares para un mes. */
function resumen_facturacion(string $ym): array {
    [$ini, $fin] = mes_rango($ym);
    $ses = rows("SELECT s.*, p.apellido, p.nombre, p.dni, p.domicilio, p.telefono
                 FROM sesiones s JOIN pacientes p ON p.id = s.paciente_id
                 WHERE " . pf('s') . " AND p.cobertura = 'particular' AND s.fecha BETWEEN ? AND ?
                 ORDER BY p.apellido, p.nombre, s.fecha", [$ini, $fin]);
    $out = [];
    foreach ($ses as $s) {
        $id = (int)$s['paciente_id'];
        $out[$id] ??= ['paciente_id' => $id, 'apellido' => $s['apellido'], 'nombre' => $s['nombre'], 'dni' => $s['dni'],
            'domicilio' => $s['domicilio'], 'telefono' => $s['telefono'], 'a_facturar' => [], 'impagas' => 0,
            'sin_marcar' => 0, 'facturadas' => 0, 'efectivo' => 0, 'transferencia' => 0];
        $r = &$out[$id];
        if ($s['estado'] === 'programada') { $r['sin_marcar']++; continue; }
        if (!es_cobrable($s['estado'])) continue;
        if ($s['factura_id']) { $r['facturadas']++; continue; }
        if (!$s['pagado']) { $r['impagas']++; continue; }
        $r['a_facturar'][] = $s;
        if ($s['medio_pago']) $r[$s['medio_pago']]++;
        unset($r);
    }
    foreach ($out as &$r) {
        $items = [];
        foreach ($r['a_facturar'] as $s) { $k = number_format((float)$s['precio'], 2, '.', ''); $items[$k] = ($items[$k] ?? 0) + 1; }
        $r['items'] = []; $r['total'] = 0; $r['cantidad'] = count($r['a_facturar']);
        foreach ($items as $precio => $cant) { $r['items'][] = ['cantidad' => $cant, 'precio' => (float)$precio]; $r['total'] += $cant * (float)$precio; }
    }
    return array_values($out);
}

/**
 * OSEP: sugiere la fecha a declarar para cada sesión asistida.
 * Reglas: una por día, nunca antes de la compra de la orden, dentro del mes,
 * en días de atención y como máximo $max_semana por semana.
 */
function sugerir_fechas_osep(string $fecha_compra, string $ym, array $fechas_reales, array $ocupadas = [], ?string $vence = null): array {
    [$ini, $fin] = mes_rango($ym);
    // Además del mes, la orden vence (un mes desde la compra): no se puede declarar una fecha posterior
    $porVencimiento = $vence && $vence < $fin;
    if ($porVencimiento) $fin = $vence;
    $dias = array_map('intval', explode(',', ajuste('dias_atencion', '2,3,4')));
    $max = (int) ajuste('osep_max_semana', '3');
    $ocup = array_fill_keys($ocupadas, true);
    $porSemana = [];
    foreach ($ocupadas as $o) { $w = date('oW', strtotime($o)); $porSemana[$w] = ($porSemana[$w] ?? 0) + 1; }
    sort($fechas_reales);
    $res = []; $prev = null;
    foreach ($fechas_reales as $real) {
        $c = max($real, $fecha_compra, $ini);
        if ($prev && $c <= $prev) $c = date('Y-m-d', strtotime("$prev +1 day"));
        $ok = null;
        while ($c <= $fin) {
            $w = date('oW', strtotime($c));
            if (in_array((int)date('N', strtotime($c)), $dias, true) && empty($ocup[$c]) && ($porSemana[$w] ?? 0) < $max) { $ok = $c; break; }
            $c = date('Y-m-d', strtotime("$c +1 day"));
        }
        if ($ok) { $ocup[$ok] = true; $porSemana[date('oW', strtotime($ok))] = ($porSemana[date('oW', strtotime($ok))] ?? 0) + 1; $prev = $ok; }
        $res[] = ['real' => $real, 'sugerida' => $ok,
            'aviso' => $ok === null ? ($porVencimiento ? 'No entra: la orden vence el ' . date('d/m', strtotime($vence)) : 'No entra en el mes con las reglas') : ($ok === $real ? '' :
                ($real < $fecha_compra ? 'Movida: orden comprada el ' . date('d/m', strtotime($fecha_compra)) : 'Movida: semana llena o día ocupado'))];
    }
    return $res;
}

/** Aplica a la ficha los aumentos programados que ya entraron en vigencia. */
function sincronizar_precios(): void {
    q("UPDATE pacientes SET precio_sesion = (SELECT pr.precio FROM precios pr WHERE pr.paciente_id = pacientes.id AND pr.profesional_id = pacientes.profesional_id AND pr.vigente_desde <= ?
         ORDER BY pr.vigente_desde DESC, pr.id DESC LIMIT 1)
       WHERE " . pf() . " AND EXISTS (SELECT 1 FROM precios pr WHERE pr.paciente_id = pacientes.id AND pr.vigente_desde <= ?)", [date('Y-m-d'), date('Y-m-d')]);
}

/**
 * Empareja tokens leídos de capturas de la credencial OSEP con pacientes y sesiones del mes.
 * Cada item: ['token', 'afiliado', 'dni', 'paciente_id' (opcional, elegido a mano)].
 * El paciente se busca por N° de afiliado completo (solo dígitos) y, si no, por DNI.
 * Los tokens se asignan en orden a las sesiones "asistió" del mes que todavía no tienen token.
 * Estados: ok | duplicado | sin_paciente | sin_sesion | invalido
 */
function emparejar_tokens(array $items, string $mes): array {
    [$ini, $fin] = mes_rango($mes);
    $dig = fn($s) => preg_replace('/\D/', '', (string)$s);
    $porAfil = $porDni = $pacs = [];
    foreach (rows("SELECT id, apellido, nombre, dni, nro_afiliado FROM pacientes WHERE " . pf()) as $p) {
        $pacs[$p['id']] = $p;
        if ($a = $dig($p['nro_afiliado'])) $porAfil[$a] = $p['id'];
        if ($d = $dig($p['dni'])) $porDni[$d] = $p['id'];
    }
    $libres = $usados = [];
    $res = [];
    foreach ($items as $it) {
        $tok = strtoupper(preg_replace('/[^0-9A-Za-z]/', '', (string)($it['token'] ?? '')));
        $pid = (int)($it['paciente_id'] ?? 0);
        $por = 'manual';
        if (!$pid && ($a = $dig($it['afiliado'] ?? '')) && isset($porAfil[$a])) { $pid = $porAfil[$a]; $por = 'afiliado'; }
        if (!$pid && ($d = $dig($it['dni'] ?? '')) && isset($porDni[$d])) { $pid = $porDni[$d]; $por = 'dni'; }
        $r = ['token' => $tok, 'afiliado' => $it['afiliado'] ?? '', 'dni' => $it['dni'] ?? '', 'paciente_id' => $pid ?: null,
              'paciente' => $pid && isset($pacs[$pid]) ? nombre_pac($pacs[$pid]) : null, 'por' => $pid ? $por : null,
              'sesion_id' => null, 'fecha' => null];
        if (!preg_match('/^[0-9A-Z]{4,12}$/', $tok)) { $res[] = $r + ['estado' => 'invalido']; continue; }
        if (!$pid || !isset($pacs[$pid])) { $res[] = $r + ['estado' => 'sin_paciente']; continue; }
        if (!isset($libres[$pid])) {
            $libres[$pid] = rows("SELECT id, fecha FROM sesiones WHERE " . pf() . " AND paciente_id = ? AND fecha BETWEEN ? AND ? AND estado = 'asistio'
                AND (token IS NULL OR token = '') ORDER BY fecha, hora", [$pid, $ini, $fin]);
            $usados[$pid] = array_flip(array_column(rows("SELECT token FROM sesiones WHERE " . pf() . " AND paciente_id = ? AND token IS NOT NULL AND token <> ''", [$pid]), 'token'));
        }
        if (isset($usados[$pid][$tok])) { $res[] = $r + ['estado' => 'duplicado']; continue; }
        $usados[$pid][$tok] = true;
        $s = array_shift($libres[$pid]);
        if (!$s) { $res[] = $r + ['estado' => 'sin_sesion']; continue; }
        $r['sesion_id'] = (int)$s['id']; $r['fecha'] = $s['fecha'];
        $res[] = $r + ['estado' => 'ok'];
    }
    return $res;
}

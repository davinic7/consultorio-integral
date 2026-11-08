<?php
function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;
    $pdo = new PDO(config('db_dsn'), config('db_user'), config('db_pass'), [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    if (str_starts_with(config('db_dsn'), 'sqlite:')) $pdo->exec('PRAGMA foreign_keys = ON');
    return $pdo;
}

// ---------- Multi-profesional ----------
// Cada profesional ve sólo sus datos. Todas estas tablas tienen profesional_id y toda consulta tiene que filtrarlo.
const TABLAS_PROF = ['pacientes', 'precios', 'turnos_fijos', 'ordenes_osep', 'sesiones', 'facturas', 'notas'];

/** Profesional de la sesión actual (o el fijado por consola con usar_profesional()). */
function pid(): int {
    global $PID;
    if (empty($PID)) throw new LogicException('No hay un profesional activo');
    return (int) $PID;
}
function usar_profesional(?int $id): void { global $PID; $PID = $id; }
/** Condición SQL "alias.profesional_id = N" (N es un entero, no hay riesgo de inyección). */
function pf(string $alias = ''): string { return ($alias !== '' ? "$alias." : '') . 'profesional_id = ' . pid(); }

/** Red de seguridad: una consulta sobre datos de pacientes que no filtra por profesional no se ejecuta. */
function chequear_aislamiento(string $sql): void {
    if (preg_match('/\b(FROM|JOIN|UPDATE|INTO)\s+(' . implode('|', TABLAS_PROF) . ')\b/i', $sql) && !str_contains($sql, 'profesional_id')) {
        throw new LogicException('Consulta sin filtro de profesional: ' . preg_replace('/\s+/', ' ', substr($sql, 0, 120)));
    }
}

function q(string $sql, array $p = []): PDOStatement {
    chequear_aislamiento($sql);
    $st = db()->prepare($sql);
    $st->execute($p);
    return $st;
}
function rows(string $sql, array $p = []): array { return q($sql, $p)->fetchAll(); }
function row(string $sql, array $p = []): ?array { $r = q($sql, $p)->fetch(); return $r ?: null; }
function val(string $sql, array $p = []) { $r = q($sql, $p)->fetchColumn(); return $r === false ? null : $r; }

function insert(string $tabla, array $datos): int {
    if (in_array($tabla, TABLAS_PROF, true)) $datos['profesional_id'] = pid();
    $cols = array_keys($datos);
    $sql = "INSERT INTO $tabla (" . implode(',', $cols) . ") VALUES (" . implode(',', array_map(fn($c) => ":$c", $cols)) . ")";
    q($sql, $datos);
    return (int) db()->lastInsertId();
}
function update(string $tabla, int $id, array $datos): void {
    unset($datos['profesional_id']);
    $set = implode(',', array_map(fn($c) => "$c = :$c", array_keys($datos)));
    $datos['__id'] = $id;
    q("UPDATE $tabla SET $set WHERE id = :__id" . (in_array($tabla, TABLAS_PROF, true) ? ' AND ' . pf() : ''), $datos);
}

/** Paciente del profesional actual, o error (para ids que vienen del formulario). */
function paciente_propio(int $id): array {
    $p = row('SELECT * FROM pacientes WHERE id = ? AND ' . pf(), [$id]);
    if (!$p) throw new RuntimeException('Paciente no encontrado');
    return $p;
}

// ---------- Ajustes ----------
// profesional_id = 0 son los ajustes generales del sistema (los del proveedor), editables por el administrador.
function ajuste(string $k, $def = '', ?int $prof = null) {
    static $cache = [];
    $prof ??= pid();
    if (!isset($cache[$prof])) {
        $cache[$prof] = [];
        foreach (rows('SELECT clave, valor FROM ajustes WHERE profesional_id = ?', [$prof]) as $r) $cache[$prof][$r['clave']] = $r['valor'];
    }
    if (func_num_args() === 4) { $cache[$prof][$k] = $def; return null; } // uso interno: actualizar la caché
    return ($cache[$prof][$k] ?? '') !== '' ? $cache[$prof][$k] : $def;
}
function guardar_ajuste(string $k, $v, ?int $prof = null): void {
    $prof ??= pid();
    if (val('SELECT COUNT(*) FROM ajustes WHERE profesional_id = ? AND clave = ?', [$prof, $k]))
        q('UPDATE ajustes SET valor = ? WHERE profesional_id = ? AND clave = ?', [$v, $prof, $k]);
    else q('INSERT INTO ajustes (profesional_id, clave, valor) VALUES (?, ?, ?)', [$prof, $k, $v]);
    ajuste($k, $v, $prof, true);
}
function ajuste_global(string $k, $def = '') { return ajuste($k, $def, 0); }
function guardar_ajuste_global(string $k, $v): void { guardar_ajuste($k, $v, 0); }

/** Carpeta de archivos del profesional actual (facturas, órdenes, planillas, certificados propios). */
function storage_prof(): string { return STORAGE . '/p' . pid(); }

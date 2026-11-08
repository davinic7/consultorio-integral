<?php
/**
 * Migra una instalación de un solo profesional a multi-profesional (se puede correr más de una vez: si ya está migrada no hace nada).
 *   php database/migrar.php
 * - Crea la tabla profesionales y pasa todo lo existente al profesional 1.
 * - Agrega profesional_id a todas las tablas y separa los ajustes por profesional.
 * - Vuelve a cifrar las notas con la clave propia del profesional 1.
 * - Mueve facturas, órdenes, planillas y certificados a storage/p1/.
 * En SQLite deja una copia de la base antes de empezar. En MySQL hacé un mysqldump antes.
 */
if (PHP_SAPI !== 'cli') exit('Ejecutar por consola');
if (!function_exists('db')) require dirname(__DIR__) . '/app/bootstrap.php';

function migrar_multi(): void {
    $pdo = db();
    $esSqlite = str_starts_with(config('db_dsn'), 'sqlite:');
    $existe = fn($t) => $esSqlite ? (bool) $pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$t'")->fetchColumn()
                                  : (bool) $pdo->query("SHOW TABLES LIKE '$t'")->fetchColumn();
    if ($existe('profesionales')) { echo "· Ya está migrada a multi-profesional\n"; return; }
    if (!$existe('usuarios')) throw new RuntimeException('No hay tablas para migrar');

    if ($esSqlite) {
        $archivo = substr(config('db_dsn'), 7);
        copy($archivo, $archivo . '.antes-multi-' . date('Ymd-His'));
        echo "✓ Copia de seguridad de la base: " . basename($archivo) . ".antes-multi-*\n";
    }
    $ai = $esSqlite ? 'INTEGER PRIMARY KEY AUTOINCREMENT' : 'INT AUTO_INCREMENT PRIMARY KEY';
    $eng = $esSqlite ? '' : ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4';

    if ($esSqlite) $pdo->beginTransaction(); // en MySQL cada ALTER confirma solo: no hay transacción posible
    $pdo->exec("CREATE TABLE profesionales (id $ai, nombre VARCHAR(120) NOT NULL, activo TINYINT NOT NULL DEFAULT 1, clave_datos TEXT NOT NULL, creado DATETIME NOT NULL)$eng");
    $nombre = $pdo->query("SELECT valor FROM ajustes WHERE clave = 'profesional'")->fetchColumn()
           ?: $pdo->query('SELECT nombre FROM usuarios ORDER BY id LIMIT 1')->fetchColumn() ?: 'Profesional';
    $pdo->prepare('INSERT INTO profesionales (id, nombre, activo, clave_datos, creado) VALUES (1, ?, 1, ?, ?)')
        ->execute([$nombre, nueva_clave_datos(), date('Y-m-d H:i:s')]);

    $pdo->exec('ALTER TABLE usuarios ADD COLUMN profesional_id INT NULL');
    $pdo->exec('ALTER TABLE usuarios ADD COLUMN es_admin TINYINT NOT NULL DEFAULT 0');
    $pdo->exec('UPDATE usuarios SET profesional_id = 1');

    foreach (TABLAS_PROF as $t) {
        $pdo->exec("ALTER TABLE $t ADD COLUMN profesional_id INT NOT NULL DEFAULT 1");
        if (!$esSqlite) $pdo->exec("ALTER TABLE $t MODIFY profesional_id INT NOT NULL"); // sin valor por defecto
        $pdo->exec("CREATE INDEX ix_{$t}_prof ON $t (profesional_id)");
    }

    $pdo->exec("CREATE TABLE ajustes_nueva (profesional_id INT NOT NULL DEFAULT 0, clave VARCHAR(60) NOT NULL, valor TEXT NULL, PRIMARY KEY (profesional_id, clave))$eng");
    $pdo->exec('INSERT INTO ajustes_nueva (profesional_id, clave, valor) SELECT 1, clave, valor FROM ajustes');
    $pdo->exec('DROP TABLE ajustes');
    $pdo->exec($esSqlite ? 'ALTER TABLE ajustes_nueva RENAME TO ajustes' : 'RENAME TABLE ajustes_nueva TO ajustes');
    if ($esSqlite) $pdo->commit();
    echo "✓ Tablas migradas: todo lo existente quedó en el profesional 1 ($nombre)\n";

    // Notas: de la app_key a la clave propia del profesional
    $n = 0;
    $up = $pdo->prepare('UPDATE notas SET contenido = ? WHERE id = ? AND profesional_id = 1');
    foreach ($pdo->query("SELECT id, contenido FROM notas WHERE contenido LIKE 'v1:%'")->fetchAll() as $nota) {
        $t = aes_descifrar(substr($nota['contenido'], 3), app_key());
        if ($t === null) { echo "  ! La nota {$nota['id']} no se pudo descifrar: se deja como estaba\n"; continue; }
        $up->execute([cifrar($t, 1), $nota['id']]); $n++;
    }
    echo "✓ Notas cifradas con la clave del profesional: $n\n";

    // Archivos
    @mkdir(STORAGE . '/p1', 0775, true);
    foreach (['facturas', 'ordenes', 'planillas', 'certs'] as $dir) {
        if (is_dir(STORAGE . "/$dir") && !is_dir(STORAGE . "/p1/$dir")) rename(STORAGE . "/$dir", STORAGE . "/p1/$dir");
    }
    foreach (glob(STORAGE . '/cache/ta_*.json') ?: [] as $f) @unlink($f);
    echo "✓ Archivos movidos a storage/p1/\n";
    // La instalación anterior usaba certificado propio: se mantiene así
    guardar_ajuste('arca_conexion', 'propio', 1);
    if ($pdo->query('SELECT COUNT(*) FROM usuarios WHERE es_admin = 1')->fetchColumn() == 0)
        echo "→ Falta crear el usuario administrador: php database/instalar.php --admin\n";
}

/** Columnas agregadas después: se crean si faltan (se puede correr siempre). */
function migrar_columnas(): void {
    $pdo = db();
    $esSqlite = str_starts_with(config('db_dsn'), 'sqlite:');
    $tiene = function (string $t, string $c) use ($pdo, $esSqlite) {
        $cols = $esSqlite ? array_column($pdo->query("PRAGMA table_info($t)")->fetchAll(), 'name')
                         : array_column($pdo->query("SHOW COLUMNS FROM $t")->fetchAll(), 'Field');
        return in_array($c, $cols, true);
    };
    foreach ([['ordenes_osep', 'fecha_vencimiento', 'DATE NULL'], ['ordenes_osep', 'codigo_practica', 'VARCHAR(20) NULL']] as [$t, $c, $def]) {
        if (!$tiene($t, $c)) { $pdo->exec("ALTER TABLE $t ADD COLUMN $c $def"); echo "✓ Columna nueva: $t.$c
"; }
    }
}

if (realpath($argv[0] ?? '') === __FILE__) { migrar_multi(); migrar_columnas(); }

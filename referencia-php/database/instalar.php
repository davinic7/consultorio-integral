<?php
/**
 * Instalador por consola.
 *   php database/instalar.php            (pregunta datos de MySQL)
 *   php database/instalar.php --sqlite   (base SQLite local, para probar)
 *   php database/instalar.php --demo     (además carga pacientes de ejemplo y usuarios demo/demo1234 y admin/admin1234)
 *   php database/instalar.php --admin    (crea el usuario administrador si todavía no existe)
 * Si encuentra una instalación anterior de un solo profesional, la migra a multi-profesional.
 */
if (PHP_SAPI !== 'cli') exit('Ejecutar por consola');
$BASE = dirname(__DIR__);
$args = array_slice($argv, 1);
$preg = function (string $txt, string $def = '') { echo $txt . ($def !== '' ? " [$def]" : '') . ': '; $r = trim((string) fgets(STDIN)); return $r === '' ? $def : $r; };

if (!is_file("$BASE/config.php")) {
    if (in_array('--sqlite', $args, true)) {
        $dsn = 'sqlite:' . $BASE . '/storage/consultorio.sqlite'; $user = $pass = '';
    } else {
        $host = $preg('Servidor MySQL', '127.0.0.1');
        $dbn  = $preg('Nombre de la base', 'consultorio');
        $user = $preg('Usuario MySQL', 'root');
        $pass = $preg('Contraseña MySQL', '');
        $pdo = new PDO("mysql:host=$host;charset=utf8mb4", $user, $pass);
        $pdo->exec("CREATE DATABASE IF NOT EXISTS `$dbn` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");
        $dsn = "mysql:host=$host;dbname=$dbn;charset=utf8mb4";
    }
    $cfg = "<?php\nreturn " . var_export([
        'db_dsn' => $dsn, 'db_user' => $user, 'db_pass' => $pass,
        'app_key' => base64_encode(random_bytes(32)),
        'zona_horaria' => 'America/Argentina/Catamarca',
    ], true) . ";\n";
    file_put_contents("$BASE/config.php", $cfg);
    @chmod("$BASE/config.php", 0600);
    echo "✓ config.php creado. GUARDÁ UNA COPIA: la app_key es necesaria para leer las notas clínicas.\n";
}

require "$BASE/app/bootstrap.php";
$esSqlite = str_starts_with(config('db_dsn'), 'sqlite:');
$hay = fn($t) => $esSqlite ? val("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?", [$t]) : val('SHOW TABLES LIKE ' . db()->quote($t));

if (!$hay('usuarios')) {
    $sql = file_get_contents(__DIR__ . '/schema.sql');
    if ($esSqlite) {
        $sql = str_replace(['INT AUTO_INCREMENT PRIMARY KEY', ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'], ['INTEGER PRIMARY KEY AUTOINCREMENT', ''], $sql);
    }
    $sql = preg_replace('/--[^\n]*/', '', $sql);
    foreach (array_filter(array_map('trim', explode(';', $sql))) as $st) db()->exec($st);
    echo "✓ Tablas creadas\n";
} elseif (!$hay('profesionales')) {
    // Instalación anterior de un solo profesional
    require_once __DIR__ . '/migrar.php';
    migrar_multi();
}
require_once __DIR__ . '/migrar.php';
migrar_columnas();

$demo = in_array('--demo', $args, true);
if (!val('SELECT COUNT(*) FROM profesionales')) {
    echo "Primer profesional\n";
    $n = $demo ? 'Laura Ejemplo' : $preg('Nombre y apellido');
    $u = $demo ? 'demo' : strtolower($preg('Usuario para ingresar'));
    $c = $demo ? 'demo1234' : $preg('Contraseña (mín. 8)');
    $prof = crear_profesional($n, $u, $c);
    echo "✓ Profesional '$n' creado (usuario '$u')\n";
    if ($demo) { usar_profesional($prof); require __DIR__ . '/demo.php'; }
}

if (!val('SELECT COUNT(*) FROM usuarios WHERE es_admin = 1') && ($demo || in_array('--admin', $args, true))) {
    echo "Usuario administrador (crea y desactiva cuentas de profesionales; no ve datos de pacientes)\n";
    $u = $demo ? 'admin' : strtolower($preg('Usuario', 'admin'));
    $c = $demo ? 'admin1234' : $preg('Contraseña (mín. 8)');
    crear_admin($u, 'Administrador', $c);
    echo "✓ Administrador '$u' creado\n";
}
echo "Listo. Abrí la carpeta public/ en el navegador (o: php -S localhost:8000 -t public)\n";

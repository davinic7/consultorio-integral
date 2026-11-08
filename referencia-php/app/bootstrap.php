<?php
declare(strict_types=1);

define('BASE', dirname(__DIR__));
define('STORAGE', BASE . '/storage');

if (!is_file(BASE . '/config.php')) {
    exit('Falta config.php. Ejecutá: php database/instalar.php');
}
$CONFIG = require BASE . '/config.php';
date_default_timezone_set($CONFIG['zona_horaria'] ?? 'America/Argentina/Catamarca');

require __DIR__ . '/lib/db.php';
require __DIR__ . '/lib/helpers.php';
require __DIR__ . '/lib/crypto.php';
require __DIR__ . '/lib/reglas.php';
require __DIR__ . '/lib/vistas.php';
require __DIR__ . '/lib/cuentas.php';

function config(string $k, $def = null) { global $CONFIG; return $CONFIG[$k] ?? $def; }

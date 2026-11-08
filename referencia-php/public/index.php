<?php
require dirname(__DIR__) . '/app/bootstrap.php';

session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax', 'secure' => !empty($_SERVER['HTTPS'])]);
session_start();

$PAGINAS = ['login', 'salir', 'inicio', 'agenda', 'pacientes', 'paciente', 'facturacion', 'osep', 'orden', 'tokens', 'dictado', 'ajustes', 'archivo'];
// El administrador sólo gestiona cuentas: no tiene acceso a datos de pacientes
$PAGINAS_ADMIN = ['login', 'salir', 'profesionales'];

$p = $_GET['p'] ?? 'inicio';
if (empty($_SESSION['uid']) && $p !== 'login') redir('login');

if (!empty($_SESSION['uid'])) {
    // Se revisa en cada pedido: si se desactiva la cuenta, deja de entrar en el momento
    $u = row('SELECT u.profesional_id, u.es_admin, p.activo FROM usuarios u LEFT JOIN profesionales p ON p.id = u.profesional_id WHERE u.id = ?', [$_SESSION['uid']]);
    if (!$u || (!$u['es_admin'] && !$u['activo'])) { session_destroy(); redir('login'); }
    $ES_ADMIN = (bool) $u['es_admin'];
    if ($ES_ADMIN) {
        if (!in_array($p, $PAGINAS_ADMIN, true)) $p = 'profesionales';
    } else {
        usar_profesional((int) $u['profesional_id']);
        if (!in_array($p, $PAGINAS, true)) $p = 'inicio';
    }
} elseif (!in_array($p, $PAGINAS, true)) $p = 'login';

$titulo = 'Consultorio';
ob_start();
try {
    require BASE . "/app/pages/$p.php";
} catch (Throwable $ex) {
    ob_clean();
    echo '<div class="alert alert-danger"><b>Error:</b> ' . e($ex->getMessage()) . '</div>';
    error_log((string) $ex);
}
$contenido = ob_get_clean();
if (!empty($SIN_LAYOUT)) { echo $contenido; exit; }
require BASE . '/app/pages/_layout.php';

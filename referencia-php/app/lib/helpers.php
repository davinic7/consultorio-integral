<?php
function e($s): string { return htmlspecialchars((string)($s ?? ''), ENT_QUOTES, 'UTF-8'); }
function url(string $p, array $q = []): string { return 'index.php?' . http_build_query(['p' => $p] + $q); }
function redir(string $p, array $q = []): never { header('Location: ' . url($p, $q)); exit; }
function flash(?string $msg = null, string $tipo = 'success') {
    if ($msg !== null) { $_SESSION['flash'][] = [$tipo, $msg]; return null; }
    $f = $_SESSION['flash'] ?? []; unset($_SESSION['flash']); return $f;
}
function csrf(): string {
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
    return $_SESSION['csrf'];
}
function csrf_field(): string { return '<input type="hidden" name="_csrf" value="' . csrf() . '">'; }
function es_post(): bool {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') return false;
    if (!hash_equals(csrf(), $_POST['_csrf'] ?? '')) { http_response_code(400); exit('Formulario vencido, recargá la página.'); }
    return true;
}
function in(string $k, $def = '') { $v = $_POST[$k] ?? $_GET[$k] ?? $def; return is_string($v) ? trim($v) : $v; }
function nulo($v) { return ($v === '' || $v === null) ? null : $v; }

function pesos($n): string { return '$ ' . number_format((float)$n, 2, ',', '.'); }
function fecha_ar(?string $f): string { return $f ? date('d/m/Y', strtotime($f)) : ''; }
const MESES = [1=>'enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const DIAS = [1=>'lunes','martes','miércoles','jueves','viernes','sábado','domingo'];
function mes_nombre(string $ym): string { [$y, $m] = explode('-', $ym); return MESES[(int)$m] . ' ' . $y; }
function mes_anterior(?string $ym = null): string { return date('Y-m', strtotime(($ym ?? date('Y-m')) . '-01 -1 month')); }
function mes_rango(string $ym): array { $d = "$ym-01"; return [$d, date('Y-m-t', strtotime($d))]; }
function edad(?string $nac): ?int { return $nac ? (int) date_diff(date_create($nac), date_create('today'))->y : null; }
function nombre_pac(array $p): string { return $p['apellido'] . ', ' . $p['nombre']; }

/** Celular argentino a formato wa.me (549 + área + número). Asume área 383 si viene sin código de área. */
function wa_numero(?string $tel): ?string {
    $d = preg_replace('/\D/', '', (string)$tel);
    if ($d === '') return null;
    $d = preg_replace('/^(00)?54/', '', $d);
    $d = ltrim($d, '0');
    if (str_starts_with($d, '9') && strlen($d) === 11) $d = substr($d, 1);
    // quitar el 15 después del código de área (ej: 383 15 4277003)
    if (preg_match('/^(\d{2,4})15(\d{6,8})$/', $d, $m) && strlen($m[1] . $m[2]) === 10) $d = $m[1] . $m[2];
    if (strlen($d) === 7) $d = ajuste('area_default', '383') . $d;
    return strlen($d) === 10 ? '549' . $d : null;
}
function wa_link(?string $tel, string $texto): ?string {
    $n = wa_numero($tel);
    return $n ? 'https://wa.me/' . $n . '?text=' . rawurlencode($texto) : null;
}

function subir_archivo(string $campo, string $carpeta, array $ext_ok): ?string {
    if (empty($_FILES[$campo]) || $_FILES[$campo]['error'] !== UPLOAD_ERR_OK) return null;
    $ext = strtolower(pathinfo($_FILES[$campo]['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, $ext_ok, true)) throw new RuntimeException('Tipo de archivo no permitido');
    @mkdir(storage_prof() . "/$carpeta", 0775, true);
    $nombre = date('Ymd_His') . '_' . bin2hex(random_bytes(3)) . ".$ext";
    move_uploaded_file($_FILES[$campo]['tmp_name'], storage_prof() . "/$carpeta/$nombre");
    return "$carpeta/$nombre";
}
function nombre_archivo(string $s): string {
    $s = iconv('UTF-8', 'ASCII//TRANSLIT', $s) ?: $s;
    return trim(preg_replace('/[^A-Za-z0-9 ._-]/', '', $s));
}

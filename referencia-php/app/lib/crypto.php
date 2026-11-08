<?php
// Cifrado de notas clínicas: AES-256-GCM.
// Cada profesional tiene su propia clave de datos (profesionales.clave_datos), guardada cifrada con la app_key de config.php.
//   v1: cifrado directo con la app_key (formato anterior a multi-profesional; sólo se lee).
//   v2: cifrado con la clave del profesional. Si se borra esa clave, sus notas quedan ilegibles para siempre.
function app_key(): string {
    $k = base64_decode((string) config('app_key'), true);
    if ($k === false || strlen($k) !== 32) throw new RuntimeException('app_key inválida en config.php');
    return $k;
}
function aes_cifrar(string $texto, string $clave): string {
    $iv = random_bytes(12);
    $c = openssl_encrypt($texto, 'aes-256-gcm', $clave, OPENSSL_RAW_DATA, $iv, $tag);
    return base64_encode($iv . $tag . $c);
}
function aes_descifrar(string $b64, string $clave): ?string {
    $b = base64_decode($b64);
    $t = openssl_decrypt(substr($b, 28), 'aes-256-gcm', $clave, OPENSSL_RAW_DATA, substr($b, 0, 12), substr($b, 12, 16));
    return $t === false ? null : $t;
}

/** Nueva clave de datos para un profesional, ya cifrada con la app_key (para guardar en profesionales.clave_datos). */
function nueva_clave_datos(): string { return 'v1:' . aes_cifrar(random_bytes(32), app_key()); }

function clave_profesional(?int $prof = null): string {
    static $cache = [];
    $prof ??= pid();
    if (!isset($cache[$prof])) {
        $env = (string) val('SELECT clave_datos FROM profesionales WHERE id = ?', [$prof]);
        $k = str_starts_with($env, 'v1:') ? aes_descifrar(substr($env, 3), app_key()) : null;
        if ($k === null || strlen($k) !== 32) throw new RuntimeException('No se pudo abrir la clave de datos del profesional (revisar app_key)');
        $cache[$prof] = $k;
    }
    return $cache[$prof];
}

function cifrar(string $texto, ?int $prof = null): string { return 'v2:' . aes_cifrar($texto, clave_profesional($prof)); }
function descifrar(string $dato, ?int $prof = null): string {
    if (str_starts_with($dato, 'v2:')) $t = aes_descifrar(substr($dato, 3), clave_profesional($prof));
    elseif (str_starts_with($dato, 'v1:')) $t = aes_descifrar(substr($dato, 3), app_key());
    else return $dato;
    return $t ?? '[no se pudo descifrar: revisar app_key]';
}

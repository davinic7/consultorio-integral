<?php
// Alta de profesionales y usuarios

const AJUSTES_INICIALES = [
    'dias_atencion' => '1,2,3,4,5', 'osep_max_semana' => '3', 'arca_modo' => 'simulado', 'arca_conexion' => 'delegado',
    'pto_vta' => '', 'area_default' => '383', 'texto_item' => 'Honorarios profesionales por psicoterapia individual',
    'precio_nuevos' => '0', 'mensaje_wa_factura' => 'Hola {nombre}, te envío la factura de las sesiones de {mes}. ¡Gracias!',
];

function validar_usuario(string $usuario, string $clave): void {
    if (!preg_match('/^[a-z0-9._-]{3,50}$/', $usuario)) throw new RuntimeException('El usuario tiene que tener entre 3 y 50 letras minúsculas, números, punto o guion.');
    if (strlen($clave) < 8) throw new RuntimeException('La contraseña debe tener al menos 8 caracteres.');
    if (val('SELECT COUNT(*) FROM usuarios WHERE usuario = ?', [$usuario])) throw new RuntimeException("El usuario '$usuario' ya existe.");
}

/** Crea el profesional, su usuario y sus ajustes iniciales. Devuelve el id del profesional. */
function crear_profesional(string $nombre, string $usuario, string $clave): int {
    $nombre = trim($nombre);
    if ($nombre === '') throw new RuntimeException('Falta el nombre del profesional.');
    validar_usuario($usuario, $clave);
    db()->beginTransaction();
    try {
        q('INSERT INTO profesionales (nombre, activo, clave_datos, creado) VALUES (?, 1, ?, ?)', [$nombre, nueva_clave_datos(), date('Y-m-d H:i:s')]);
        $prof = (int) db()->lastInsertId();
        q('INSERT INTO usuarios (profesional_id, es_admin, usuario, nombre, pass_hash, creado) VALUES (?, 0, ?, ?, ?, ?)',
            [$prof, $usuario, $nombre, password_hash($clave, PASSWORD_DEFAULT), date('Y-m-d H:i:s')]);
        foreach (AJUSTES_INICIALES + ['profesional' => $nombre] as $k => $v) guardar_ajuste($k, $v, $prof);
        db()->commit();
    } catch (Throwable $e) { db()->rollBack(); throw $e; }
    @mkdir(STORAGE . "/p$prof", 0775, true);
    return $prof;
}

function crear_admin(string $usuario, string $nombre, string $clave): void {
    validar_usuario($usuario, $clave);
    q('INSERT INTO usuarios (profesional_id, es_admin, usuario, nombre, pass_hash, creado) VALUES (NULL, 1, ?, ?, ?, ?)',
        [$usuario, $nombre, password_hash($clave, PASSWORD_DEFAULT), date('Y-m-d H:i:s')]);
}

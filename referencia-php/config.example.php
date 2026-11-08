<?php
// Copiar como config.php (o correr: php database/instalar.php)
return [
    // MySQL / MariaDB
    'db_dsn'  => 'mysql:host=127.0.0.1;dbname=consultorio;charset=utf8mb4',
    'db_user' => 'root',
    'db_pass' => '',
    // Para probar sin MySQL: 'db_dsn' => 'sqlite:' . __DIR__ . '/storage/consultorio.sqlite',

    // Clave para cifrar las notas clínicas (32 bytes en base64). ¡NO PERDERLA! Sin ella no se leen las notas.
    'app_key' => 'CAMBIAR',

    'zona_horaria' => 'America/Argentina/Catamarca',
];

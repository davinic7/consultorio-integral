<?php
// Sirve archivos de la carpeta del profesional (storage/pN/): sólo con sesión iniciada, sin salir de esa carpeta y nunca los certificados
$rel = (string) in('f');
$base = realpath(storage_prof());
$ruta = $base ? realpath($base . '/' . $rel) : false;
if (!$ruta || !str_starts_with($ruta, $base . DIRECTORY_SEPARATOR) || str_contains($rel, 'certs') || !is_file($ruta)) {
    http_response_code(404); exit('Archivo no encontrado');
}
$ext = strtolower(pathinfo($ruta, PATHINFO_EXTENSION));
$tipos = ['pdf' => 'application/pdf', 'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp'];
if (!isset($tipos[$ext])) { http_response_code(403); exit; }
while (ob_get_level()) ob_end_clean();
header('Content-Type: ' . $tipos[$ext]);
header('Content-Disposition: ' . (in('descargar') ? 'attachment' : 'inline') . '; filename="' . basename($ruta) . '"');
header('Content-Length: ' . filesize($ruta));
readfile($ruta);
exit;

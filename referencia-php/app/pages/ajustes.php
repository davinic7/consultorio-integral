<?php
require_once BASE . '/app/lib/Arca.php';
$titulo = 'Ajustes';
$CAMPOS = [
    'Profesional' => [
        'profesional' => ['Nombre de la profesional', 'Lic. ...'], 'matricula' => ['Matrícula', 'MP-'],
        'dias_atencion' => ['Días de atención (1=lun … 7=dom, separados por coma)', '2,3,4'], 'area_default' => ['Código de área por defecto', '383'],
    ],
    'Facturación (ARCA)' => [
        'razon_social' => ['Razón social (como figura en ARCA)', ''], 'cuit' => ['CUIT', ''], 'domicilio_fiscal' => ['Domicilio comercial', ''],
        'iibb' => ['Ingresos Brutos', ''], 'inicio_actividades' => ['Inicio de actividades (dd/mm/aaaa)', ''],
        'pto_vta' => ['Punto de venta (tipo Web Services)', '2'], 'texto_item' => ['Texto del ítem', 'Honorarios profesionales por psicoterapia individual'],
        'mensaje_wa_factura' => ['Mensaje de WhatsApp con la factura ({nombre}, {mes})', 'Hola {nombre}, te envío la factura de las sesiones de {mes}. ¡Gracias!'],
    ],
    'OSEP' => [
        'osep_url' => ['Dirección del SIA de OSEP', 'https://'], 'osep_max_semana' => ['Máximo de sesiones por semana', '3'],
    ],
];
$conexion = ajuste('arca_conexion', 'delegado') === 'propio' ? 'propio' : 'delegado';

if (es_post()) {
    $acc = in('accion');
    if ($acc === 'guardar') {
        foreach ($CAMPOS as $grupo) foreach ($grupo as $k => $_) guardar_ajuste($k, in($k));
        $m = in('arca_modo');
        guardar_ajuste('arca_modo', in_array($m, ['simulado', 'homologacion', 'produccion'], true) ? $m : 'simulado');
        guardar_ajuste('arca_conexion', in('arca_conexion') === 'propio' ? 'propio' : 'delegado');
        flash('Ajustes guardados');
    } elseif ($acc === 'csr') {
        arca_descargar_csr(dir_certs_propios(), ajuste('cuit'), ajuste('razon_social'));
    } elseif ($acc === 'cert') {
        arca_guardar_crt(dir_certs_propios());
        flash('Certificado cargado.');
    } elseif ($acc === 'probar') {
        $modo = ajuste('arca_modo', 'simulado');
        if ($modo === 'simulado') { flash('En modo simulado no se conecta con ARCA.', 'info'); }
        else {
            $a = arca_profesional();
            $msg = 'Servidores ARCA: ' . e($a->dummy());
            $msg .= '<br>Último comprobante Factura C en punto de venta ' . (int) ajuste('pto_vta') . ': <b>' . $a->ultimoComprobante(11) . '</b>';
            flash($msg, 'success');
        }
    } elseif ($acc === 'clave') {
        $u = row('SELECT * FROM usuarios WHERE id = ?', [$_SESSION['uid']]);
        if (!password_verify(in('actual'), $u['pass_hash'])) throw new RuntimeException('La contraseña actual no es correcta');
        if (strlen(in('nueva')) < 8) throw new RuntimeException('La nueva contraseña debe tener al menos 8 caracteres');
        q('UPDATE usuarios SET pass_hash = ? WHERE id = ?', [password_hash(in('nueva'), PASSWORD_DEFAULT), $u['id']]);
        flash('Contraseña cambiada');
    }
    redir('ajustes');
}
$modo = ajuste('arca_modo', 'simulado');
$propio = arca_estado_cert(dir_certs_propios());
$prov = arca_estado_cert(dir_certs_proveedor());
$cuitProv = ajuste_global('proveedor_cuit');
?>
<h1 class="h3">Ajustes</h1>
<form method="post" class="card card-body mb-3">
  <?= csrf_field() ?><input type="hidden" name="accion" value="guardar">
  <?php foreach ($CAMPOS as $grupo => $campos): ?>
    <h2 class="h6 mt-2"><?= e($grupo) ?></h2>
    <div class="row g-2">
    <?php foreach ($campos as $k => [$label, $ph]): ?>
      <div class="col-md-6"><label class="form-label small"><?= e($label) ?></label><input class="form-control" name="<?= $k ?>" value="<?= e(ajuste($k)) ?>" placeholder="<?= e($ph) ?>"></div>
    <?php endforeach ?>
    <?php if ($grupo === 'Facturación (ARCA)'): ?>
      <div class="col-md-6"><label class="form-label small">Modo</label><select class="form-select" name="arca_modo">
        <?php foreach (['simulado' => 'Simulado (pruebas, sin ARCA)', 'homologacion' => 'Homologación (ARCA de prueba)', 'produccion' => 'Producción (facturas reales)'] as $k => $t): ?>
          <option value="<?= $k ?>" <?= $modo === $k ? 'selected' : '' ?>><?= $t ?></option><?php endforeach ?></select></div>
      <div class="col-md-6"><label class="form-label small">Conexión con ARCA</label><select class="form-select" name="arca_conexion">
        <option value="delegado" <?= $conexion === 'delegado' ? 'selected' : '' ?>>Delegando la facturación al sistema (recomendado)</option>
        <option value="propio" <?= $conexion === 'propio' ? 'selected' : '' ?>>Con certificado propio</option></select></div>
    <?php endif ?>
    </div>
  <?php endforeach ?>
  <button class="btn btn-primary mt-3">Guardar ajustes</button>
</form>

<div class="card card-body mb-3">
<?php if ($conexion === 'delegado'): ?>
  <h2 class="h6">Habilitar la facturación (delegando en el sistema)</h2>
  <?php if (!$cuitProv || !$prov['crt']): ?>
    <div class="alert alert-warning small py-2">El administrador del sistema todavía no terminó de configurar la facturación por delegación. Mientras tanto podés usar el modo Simulado o un certificado propio.</div>
  <?php endif ?>
  <p class="small mb-1">Se hace una sola vez, en la web de ARCA con tu clave fiscal. No hace falta generar certificados.</p>
  <ol class="small">
    <li><b>Administrador de Relaciones de Clave Fiscal</b> → <b>Nueva relación</b> → Buscar → ARCA → WebServices → <b>Facturación Electrónica</b>.</li>
    <li>En <b>Representante</b> poné el CUIT <b class="copiable" data-copiar="<?= e(preg_replace('/\D/', '', $cuitProv)) ?>"><?= e($cuitProv ?: '(falta configurar)') ?></b> y confirmá.</li>
    <li><b>Administración de puntos de venta</b> → nuevo punto de venta tipo <b>"RECE para aplicativo y web services"</b> y anotalo arriba.</li>
    <li>Completá tu CUIT arriba, elegí modo <b>Producción</b>, guardá y tocá <b>Probar conexión</b>.</li>
  </ol>
<?php else: ?>
  <h2 class="h6">Certificado propio de ARCA</h2>
  <ol class="small">
    <li>Generá el pedido acá abajo (descarga <code>pedido_arca.csr</code>; la clave privada queda guardada en el servidor). <?= $propio['clave'] ? '<span class="badge text-bg-success">clave generada</span>' : '' ?></li>
    <li>En ARCA con clave fiscal: <b>Administración de Certificados Digitales</b> → agregar alias → subir el .csr → descargar el certificado (.crt).</li>
    <li>En ARCA: <b>Administrador de Relaciones</b> → Nueva relación → servicio <b>Facturación Electrónica (wsfe)</b> → representante: el alias del certificado.</li>
    <li>En ARCA: <b>Administración de puntos de venta</b> → nuevo punto de venta tipo <b>"RECE para aplicativo y web services"</b> y anotarlo arriba.</li>
    <li>Subí el .crt acá abajo, guardá modo <b>Producción</b> y tocá <b>Probar conexión</b>.</li>
  </ol>
<?php endif ?>
  <div class="d-flex flex-wrap gap-2">
    <?php if ($conexion === 'propio'): ?>
    <form method="post"><?= csrf_field() ?><input type="hidden" name="accion" value="csr"><button class="btn btn-sm btn-outline-primary" <?= $propio['crt'] ? 'onclick="return confirm(\'Ya hay un certificado cargado. Generar otra clave lo invalida. ¿Seguir?\')"' : '' ?>>1. Generar pedido (CSR)</button></form>
    <form method="post" enctype="multipart/form-data" class="d-flex gap-1"><?= csrf_field() ?><input type="hidden" name="accion" value="cert"><input type="file" name="crt" accept=".crt,.pem,.cer" class="form-control form-control-sm"><button class="btn btn-sm btn-outline-primary text-nowrap">5. Subir .crt</button></form>
    <?php endif ?>
    <form method="post"><?= csrf_field() ?><input type="hidden" name="accion" value="probar"><button class="btn btn-sm btn-outline-success">Probar conexión</button></form>
  </div>
  <?php if ($conexion === 'propio' && $propio['crt']): ?><div class="small mt-2">Certificado cargado<?= $propio['vence'] ? ', vence el ' . date('d/m/Y', $propio['vence']) : '' ?>.</div><?php endif ?>
</div>

<form method="post" class="card card-body" style="max-width:480px">
  <?= csrf_field() ?><input type="hidden" name="accion" value="clave">
  <h2 class="h6">Cambiar contraseña</h2>
  <input type="password" class="form-control mb-2" name="actual" placeholder="Contraseña actual" required>
  <input type="password" class="form-control mb-2" name="nueva" placeholder="Nueva contraseña (mín. 8)" required>
  <button class="btn btn-outline-primary">Cambiar</button>
</form>

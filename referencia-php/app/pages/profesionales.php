<?php
// Administración de cuentas (sólo el usuario administrador). No muestra datos de pacientes: sólo cantidades.
require_once BASE . '/app/lib/Arca.php';
if (empty($ES_ADMIN)) redir('inicio');
$titulo = 'Profesionales';

if (es_post()) {
    $acc = in('accion');
    $prof = (int) in('profesional_id');
    if ($acc === 'crear') {
        crear_profesional(in('nombre'), strtolower(in('usuario')), (string) ($_POST['clave'] ?? ''));
        flash('Profesional creado. Pasale el usuario y la contraseña para que entre y complete sus Ajustes.');
    } elseif ($acc === 'activo') {
        q('UPDATE profesionales SET activo = ? WHERE id = ?', [in('valor') ? 1 : 0, $prof]);
        flash(in('valor') ? 'Cuenta activada' : 'Cuenta desactivada: ya no puede entrar (sus datos se conservan)', in('valor') ? 'success' : 'warning');
    } elseif ($acc === 'clave') {
        $clave = (string) ($_POST['clave'] ?? '');
        if (strlen($clave) < 8) throw new RuntimeException('La contraseña debe tener al menos 8 caracteres.');
        q('UPDATE usuarios SET pass_hash = ? WHERE profesional_id = ? AND es_admin = 0', [password_hash($clave, PASSWORD_DEFAULT), $prof]);
        flash('Contraseña cambiada');
    } elseif ($acc === 'proveedor') {
        guardar_ajuste_global('proveedor_cuit', in('proveedor_cuit'));
        guardar_ajuste_global('proveedor_razon', in('proveedor_razon'));
        flash('Datos del proveedor guardados');
    } elseif ($acc === 'csr') {
        arca_descargar_csr(dir_certs_proveedor(), ajuste_global('proveedor_cuit'), ajuste_global('proveedor_razon'));
    } elseif ($acc === 'cert') {
        arca_guardar_crt(dir_certs_proveedor());
        flash('Certificado del proveedor cargado');
    }
    redir('profesionales');
}

$profs = rows('SELECT p.*, (SELECT GROUP_CONCAT(u.usuario) FROM usuarios u WHERE u.profesional_id = p.id) AS usuarios FROM profesionales p ORDER BY p.nombre');
$pacientes = array_column(rows('SELECT profesional_id, COUNT(*) AS n FROM pacientes WHERE activo = 1 GROUP BY profesional_id'), 'n', 'profesional_id');
$prov = arca_estado_cert(dir_certs_proveedor());
?>
<h1 class="h3">Profesionales</h1>
<div class="row g-3">
  <div class="col-lg-7">
    <div class="card card-body">
      <div class="table-responsive"><table class="table tabla-compacta mb-0">
        <thead><tr><th>Profesional</th><th>Usuario</th><th class="text-end">Pacientes activos</th><th>Alta</th><th></th></tr></thead>
        <tbody>
        <?php foreach ($profs as $pr): ?>
          <tr class="<?= $pr['activo'] ? '' : 'text-muted' ?>">
            <td><?= e($pr['nombre']) ?> <?= $pr['activo'] ? '' : '<span class="badge text-bg-secondary">desactivada</span>' ?></td>
            <td><?= e($pr['usuarios']) ?></td>
            <td class="text-end"><?= (int)($pacientes[$pr['id']] ?? 0) ?></td>
            <td><?= fecha_ar(substr($pr['creado'], 0, 10)) ?></td>
            <td class="text-nowrap">
              <form method="post" class="d-inline"><?= csrf_field() ?><input type="hidden" name="accion" value="activo"><input type="hidden" name="profesional_id" value="<?= $pr['id'] ?>"><input type="hidden" name="valor" value="<?= $pr['activo'] ? 0 : 1 ?>">
                <button class="btn btn-sm <?= $pr['activo'] ? 'btn-outline-secondary' : 'btn-outline-success' ?>" <?= $pr['activo'] ? 'onclick="return confirm(\'¿Desactivar la cuenta? No va a poder entrar, pero sus datos se conservan.\')"' : '' ?>><?= $pr['activo'] ? 'Desactivar' : 'Activar' ?></button></form>
              <details class="d-inline-block"><summary class="btn btn-sm btn-outline-primary">Contraseña</summary>
                <form method="post" class="d-flex gap-1 mt-1"><?= csrf_field() ?><input type="hidden" name="accion" value="clave"><input type="hidden" name="profesional_id" value="<?= $pr['id'] ?>">
                  <input type="password" name="clave" class="form-control form-control-sm" placeholder="Nueva (mín. 8)" minlength="8" required><button class="btn btn-sm btn-primary">OK</button></form></details>
            </td>
          </tr>
        <?php endforeach ?>
        <?php if (!$profs): ?><tr><td colspan="5" class="text-muted">Todavía no hay profesionales.</td></tr><?php endif ?>
        </tbody>
      </table></div>
    </div>
  </div>
  <div class="col-lg-5">
    <form method="post" class="card card-body mb-3">
      <?= csrf_field() ?><input type="hidden" name="accion" value="crear">
      <h2 class="h6">Nuevo profesional</h2>
      <input class="form-control mb-2" name="nombre" placeholder="Nombre y apellido" required>
      <input class="form-control mb-2" name="usuario" placeholder="Usuario (ej: jperez)" pattern="[a-z0-9._\-]{3,50}" autocapitalize="none" required>
      <input class="form-control mb-2" type="password" name="clave" placeholder="Contraseña inicial (mín. 8)" minlength="8" required autocomplete="new-password">
      <button class="btn btn-primary">Crear</button>
    </form>

    <div class="card card-body">
      <h2 class="h6">Facturación por delegación (certificado del proveedor)</h2>
      <p class="small">Los profesionales delegan el servicio "Facturación Electrónica" a este CUIT y el sistema factura por ellos con un solo certificado.</p>
      <form method="post" class="mb-2"><?= csrf_field() ?><input type="hidden" name="accion" value="proveedor">
        <input class="form-control form-control-sm mb-1" name="proveedor_cuit" value="<?= e(ajuste_global('proveedor_cuit')) ?>" placeholder="CUIT del proveedor">
        <input class="form-control form-control-sm mb-1" name="proveedor_razon" value="<?= e(ajuste_global('proveedor_razon')) ?>" placeholder="Razón social del proveedor">
        <button class="btn btn-sm btn-outline-primary">Guardar</button></form>
      <ol class="small">
        <li>Generá el pedido (CSR) <?= $prov['clave'] ? '<span class="badge text-bg-success">clave generada</span>' : '' ?></li>
        <li>En ARCA, con la clave fiscal del proveedor: <b>Administración de Certificados Digitales</b> → alias → subir el .csr → descargar el .crt.</li>
        <li><b>Administrador de Relaciones</b>: asociar el alias del certificado al servicio <b>Facturación Electrónica</b>.</li>
        <li>Subí el .crt acá.</li>
      </ol>
      <div class="d-flex flex-wrap gap-2">
        <form method="post"><?= csrf_field() ?><input type="hidden" name="accion" value="csr"><button class="btn btn-sm btn-outline-primary" <?= $prov['crt'] ? 'onclick="return confirm(\'Ya hay un certificado. Generar otra clave lo invalida y deja de facturar para todos. ¿Seguir?\')"' : '' ?>>Generar pedido (CSR)</button></form>
        <form method="post" enctype="multipart/form-data" class="d-flex gap-1"><?= csrf_field() ?><input type="hidden" name="accion" value="cert"><input type="file" name="crt" accept=".crt,.pem,.cer" class="form-control form-control-sm"><button class="btn btn-sm btn-outline-primary text-nowrap">Subir .crt</button></form>
      </div>
      <?php if ($prov['crt']): ?><div class="small mt-2">Certificado cargado<?= $prov['vence'] ? ', vence el ' . date('d/m/Y', $prov['vence']) : '' ?>.</div><?php endif ?>
    </div>
  </div>
</div>

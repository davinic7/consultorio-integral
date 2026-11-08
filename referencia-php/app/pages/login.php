<?php
$titulo = 'Ingresar';
$err = '';
if (es_post()) {
    $u = row('SELECT u.*, p.activo FROM usuarios u LEFT JOIN profesionales p ON p.id = u.profesional_id WHERE u.usuario = ?', [strtolower(in('usuario'))]);
    // freno simple contra fuerza bruta
    $_SESSION['intentos'] = ($_SESSION['intentos'] ?? 0) + 1;
    if ($_SESSION['intentos'] > 5) sleep(2);
    if ($u && password_verify(in('clave'), $u['pass_hash'])) {
        if (!$u['es_admin'] && !$u['activo']) {
            $err = 'La cuenta está desactivada. Consultá al administrador del sistema.';
        } else {
            session_regenerate_id(true);
            $_SESSION['uid'] = $u['id']; $_SESSION['nombre'] = $u['nombre']; $_SESSION['intentos'] = 0;
            redir($u['es_admin'] ? 'profesionales' : 'inicio');
        }
    } else $err = 'Usuario o contraseña incorrectos';
}
?>
<div class="row justify-content-center mt-5">
  <div class="col-sm-8 col-md-5 col-lg-4">
    <div class="card p-4">
      <h1 class="h4 mb-3 text-center">Consultorio</h1>
      <?php if ($err): ?><div class="alert alert-danger py-2"><?= e($err) ?></div><?php endif ?>
      <form method="post">
        <?= csrf_field() ?>
        <input class="form-control mb-2" name="usuario" placeholder="Usuario" autocomplete="username" required autofocus>
        <input class="form-control mb-3" name="clave" type="password" placeholder="Contraseña" autocomplete="current-password" required>
        <button class="btn btn-primary w-100">Ingresar</button>
      </form>
    </div>
  </div>
</div>

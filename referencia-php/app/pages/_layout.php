<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#3b4f7a">
<title><?= e($titulo) ?> · Consultorio</title>
<link href="assets/vendor/bootstrap.min.css" rel="stylesheet">
<link href="assets/app.css" rel="stylesheet">
</head>
<body>
<?php if (!empty($_SESSION['uid'])): ?>
<nav class="navbar navbar-expand-lg navbar-dark app-nav sticky-top">
  <div class="container-fluid">
    <a class="navbar-brand fw-semibold" href="<?= url(!empty($ES_ADMIN) ? 'profesionales' : 'inicio') ?>">Consultorio<?= !empty($ES_ADMIN) ? ' · Administración' : '' ?></a>
    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#menu"><span class="navbar-toggler-icon"></span></button>
    <div class="collapse navbar-collapse" id="menu">
      <ul class="navbar-nav me-auto">
        <?php foreach (!empty($ES_ADMIN) ? ['profesionales' => 'Profesionales'] : ['agenda' => 'Agenda', 'pacientes' => 'Pacientes', 'dictado' => 'Dictar nota', 'facturacion' => 'Facturación', 'osep' => 'OSEP', 'ajustes' => 'Ajustes'] as $k => $v): ?>
          <li class="nav-item"><a class="nav-link <?= $p === $k ? 'active' : '' ?>" href="<?= url($k) ?>"><?= $v ?></a></li>
        <?php endforeach ?>
      </ul>
      <span class="navbar-text small me-2 text-white-50"><?= e($_SESSION['nombre'] ?? '') ?></span>
      <a class="btn btn-sm btn-outline-light" href="<?= url('salir') ?>">Salir</a>
    </div>
  </div>
</nav>
<?php endif ?>
<main class="container py-3">
  <?php foreach (flash() as [$tipo, $msg]): ?>
    <div class="alert alert-<?= e($tipo) ?> alert-dismissible fade show"><?= $msg ?><button type="button" class="btn-close" data-bs-dismiss="alert"></button></div>
  <?php endforeach ?>
  <?= $contenido ?>
</main>
<script src="assets/vendor/bootstrap.bundle.min.js"></script>
<script src="assets/app.js"></script>
</body>
</html>

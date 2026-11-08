<?php
$titulo = 'Dictar nota';
$ses = in('sesion_id') ? row('SELECT * FROM sesiones WHERE ' . pf() . ' AND id = ?', [(int) in('sesion_id')]) : null;
$pid = $ses ? (int)$ses['paciente_id'] : (int) in('paciente_id');

if (es_post()) {
    $texto = trim((string) in('texto'));
    $pid = (int) in('paciente_id');
    if ($texto === '' || !$pid) throw new RuntimeException('Elegí el paciente y escribí o dictá la nota.');
    paciente_propio($pid);
    if (in('sesion_id') && !val('SELECT COUNT(*) FROM sesiones WHERE ' . pf() . ' AND id = ? AND paciente_id = ?', [(int) in('sesion_id'), $pid])) throw new RuntimeException('Sesión no encontrada');
    insert('notas', ['paciente_id' => $pid, 'sesion_id' => nulo(in('sesion_id')), 'fecha' => in('fecha') ?: date('Y-m-d'),
        'tipo' => in('tipo') === 'historia' ? 'historia' : 'sesion', 'contenido' => cifrar($texto), 'creado' => date('Y-m-d H:i:s')]);
    flash('Nota guardada (cifrada).');
    redir('paciente', ['id' => $pid]);
}

// Turnos de hoy para elegir rápido
$hoy = rows("SELECT s.id, s.hora, s.paciente_id, p.apellido, p.nombre FROM sesiones s JOIN pacientes p ON p.id = s.paciente_id WHERE " . pf('s') . " AND s.fecha = ? ORDER BY s.hora", [date('Y-m-d')]);
?>
<h1 class="h3">Dictar nota de sesión</h1>
<p class="small text-muted">No se graba la sesión: al terminar, tocás el micrófono y contás en 2 o 3 minutos lo importante. Podés corregir el texto antes de guardar.</p>

<?php if ($hoy && !$pid): ?>
  <div class="d-flex flex-wrap gap-1 mb-3"><?php foreach ($hoy as $h): ?>
    <a class="btn btn-sm btn-outline-primary" href="<?= url('dictado', ['sesion_id' => $h['id']]) ?>"><?= e($h['hora']) ?> <?= e(nombre_pac($h)) ?></a>
  <?php endforeach ?></div>
<?php endif ?>

<form method="post" class="card card-body">
  <?= csrf_field() ?>
  <input type="hidden" name="sesion_id" value="<?= e($ses['id'] ?? '') ?>">
  <div class="row g-2 mb-2">
    <div class="col-md-6"><?= select_pacientes('paciente_id', $pid ?: null, false) ?></div>
    <div class="col-6 col-md-3"><input type="date" class="form-control" name="fecha" value="<?= e($ses['fecha'] ?? date('Y-m-d')) ?>"></div>
    <div class="col-6 col-md-3"><select class="form-select" name="tipo"><option value="sesion">Nota de sesión</option><option value="historia">Historia clínica inicial</option></select></div>
  </div>

  <div class="text-center my-2">
    <button type="button" id="mic" class="btn btn-danger mic">🎤</button>
    <div id="estado" class="small text-muted mt-2">Tocá para empezar a dictar</div>
  </div>
  <div class="d-flex flex-wrap gap-1 mb-1">
    <?php foreach (['Observaciones:', 'Temas trabajados:', 'Estado emocional:', 'Tareas / acuerdos:', 'Para la próxima sesión:'] as $t): ?>
      <button type="button" class="btn btn-sm btn-light border titulo"><?= e($t) ?></button>
    <?php endforeach ?>
  </div>
  <textarea class="form-control" name="texto" id="texto" rows="12" placeholder="Lo que dictes aparece acá. También podés usar el micrófono del teclado del celular."></textarea>
  <button class="btn btn-primary mt-3">Guardar nota</button>
</form>

<script>
(() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const btn = document.getElementById('mic'), est = document.getElementById('estado'), txt = document.getElementById('texto');
  document.querySelectorAll('.titulo').forEach(b => b.onclick = () => { txt.value += (txt.value && !txt.value.endsWith('\n') ? '\n\n' : '') + b.textContent + ' '; txt.focus(); });
  if (!SR) { btn.disabled = true; est.textContent = 'Este navegador no permite dictado: usá Chrome en el celular, o el micrófono del teclado.'; return; }
  if (!window.isSecureContext) { est.textContent = 'El dictado necesita que el sistema se abra con https://'; }
  const rec = new SR(); rec.lang = 'es-AR'; rec.continuous = true; rec.interimResults = true;
  let activo = false, base = '';
  rec.onresult = (ev) => {
    let fin = '', parcial = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i]; (r.isFinal ? (fin += r[0].transcript) : (parcial += r[0].transcript));
    }
    if (fin) { base += (base && !/\s$/.test(base) ? ' ' : '') + fin.trim(); }
    txt.value = base + (parcial ? ' ' + parcial : '');
  };
  rec.onend = () => { if (activo) rec.start(); }; // Chrome corta solo tras un silencio: se reanuda
  rec.onerror = (e) => { if (e.error === 'not-allowed') { activo = false; est.textContent = 'Permití el uso del micrófono.'; btn.classList.remove('grabando'); } };
  btn.onclick = () => {
    activo = !activo;
    if (activo) { base = txt.value; rec.start(); btn.classList.add('grabando'); est.textContent = 'Escuchando… tocá de nuevo para terminar'; }
    else { rec.stop(); btn.classList.remove('grabando'); est.textContent = 'Listo. Revisá el texto y guardá.'; }
  };
})();
</script>

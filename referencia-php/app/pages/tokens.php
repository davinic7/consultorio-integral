<?php
// Carga de tokens OSEP a partir de las capturas de la credencial que mandan los pacientes por WhatsApp.
// El texto se lee en el navegador (Tesseract.js): las imágenes no se suben al servidor, solo el token, el afiliado y el DNI leídos.
$mes = preg_match('/^\d{4}-\d{2}$/', (string) in('mes')) ? in('mes') : date('Y-m');

if (es_post()) {
    $SIN_LAYOUT = true;
    header('Content-Type: application/json; charset=utf-8');
    $items = json_decode((string) in('items'), true);
    if (!is_array($items)) { echo json_encode(['error' => 'Datos inválidos']); return; }
    $items = array_slice($items, 0, 200);
    $res = emparejar_tokens($items, $mes);
    if (in('accion') === 'guardar') {
        $n = 0;
        db()->beginTransaction();
        foreach ($res as $i => $r) {
            if ($r['estado'] !== 'ok') continue;
            q("UPDATE sesiones SET token = ? WHERE " . pf() . " AND id = ? AND (token IS NULL OR token = '')", [$r['token'], $r['sesion_id']]);
            $n++;
            // Si el paciente se encontró por DNI y no tenía N° de afiliado, se completa con el de la credencial
            if ($r['por'] === 'dni' && ($af = trim((string)($items[$i]['afiliado'] ?? '')))) {
                q("UPDATE pacientes SET nro_afiliado = ? WHERE " . pf() . " AND id = ? AND (nro_afiliado IS NULL OR nro_afiliado = '')", [$af, $r['paciente_id']]);
            }
        }
        db()->commit();
        flash($n === 1 ? 'Se guardó 1 token' : "Se guardaron $n tokens");
        echo json_encode(['ok' => true, 'guardados' => $n, 'volver' => url('osep', ['mes' => $mes])]);
        return;
    }
    echo json_encode(['items' => $res]);
    return;
}

$titulo = 'Tokens OSEP';
$pacs = rows("SELECT id, apellido, nombre FROM pacientes WHERE " . pf() . " AND cobertura = 'osep' AND usa_token = 1 ORDER BY apellido, nombre");
?>
<div class="d-flex flex-wrap align-items-center gap-2 mb-2">
  <h1 class="h3 me-auto mb-0">Tokens OSEP · <?= mes_nombre($mes) ?></h1>
  <a class="btn btn-sm btn-outline-secondary" href="<?= url('tokens', ['mes' => mes_anterior($mes)]) ?>">‹</a>
  <a class="btn btn-sm btn-outline-secondary" href="<?= url('tokens', ['mes' => date('Y-m', strtotime("$mes-01 +1 month"))]) ?>">›</a>
</div>
<p class="small text-muted mb-2">Elegí las capturas de la credencial que mandaron los pacientes. Podés elegir varias juntas, aunque sean de distintos pacientes:
  el sistema reconoce a cada uno por el N° de afiliado o el DNI y pone los tokens en las sesiones de <?= MESES[(int)substr($mes, 5)] ?> que todavía no tienen.
  Las imágenes se leen en este dispositivo y no se suben al servidor.</p>

<div id="tk" data-csrf="<?= e(csrf()) ?>" data-mes="<?= e($mes) ?>" data-url="<?= e(url('tokens', ['mes' => $mes])) ?>"
     data-pacientes="<?= e(json_encode(array_map(fn($p) => ['id' => (int)$p['id'], 'n' => nombre_pac($p)], $pacs))) ?>">
  <label class="btn btn-primary btn-lg w-100 mb-3" style="max-width:420px">
    📷 Elegir capturas de tokens
    <input type="file" id="tk-archivos" accept="image/*" multiple hidden>
  </label>
  <div id="tk-estado" class="small text-muted mb-2"></div>
  <div id="tk-lista"></div>
  <button id="tk-guardar" class="btn btn-success d-none">Guardar tokens</button>
</div>

<script src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js"></script>
<script src="assets/tokens.js"></script>

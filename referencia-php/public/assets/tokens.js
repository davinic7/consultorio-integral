// Lectura de tokens OSEP desde capturas de la credencial virtual (OCR en el navegador con Tesseract.js)
(() => {
  const raiz = document.getElementById('tk');
  if (!raiz) return;
  const $ = (id) => document.getElementById(id);
  const pacientes = JSON.parse(raiz.dataset.pacientes || '[]');
  const ESTADOS = {
    ok: ['success', 'Listo'],
    duplicado: ['secondary', 'Ya cargado'],
    sin_paciente: ['warning', 'Elegí el paciente'],
    sin_sesion: ['warning', 'Sobra: no hay sesión sin token'],
    invalido: ['danger', 'Revisá el token'],
  };
  let items = []; // {img, token, afiliado, dni, nombre, paciente_id, ...resultado del servidor}
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Saca token, afiliado, DNI y nombre de lo que leyó el OCR en la captura. */
  function extraer(data) {
    const texto = data.text;
    const af = texto.match(/(\d{2})\s*-\s*(\d{4,8})\s*-\s*(\d{2})/);
    const dni = texto.match(/Documento\D{0,4}(\d[\d.]{6,10})/i);
    const nom = texto.match(/Nombre\s+([^\n]+?)(\s+segundos)?\s*$/im);
    const dniTxt = dni ? dni[1].replace(/\D/g, '') : '';
    // El token son 6 caracteres hexadecimales (ej: 9BF208) y es el texto más grande de la pantalla.
    // Se descartan los números que son parte del afiliado, del DNI o de la fecha de nacimiento.
    const otros = (af ? af[0] : '') + ' ' + dniTxt + ' ' + (texto.match(/\d{2}\/\d{2}\/\d{4}/) || [''])[0].replace(/\D/g, '');
    const cands = (data.words || [])
      .map((w) => ({ t: w.text.replace(/[^0-9A-Za-z]/g, '').toUpperCase().replace(/O/g, '0'), h: w.bbox.y1 - w.bbox.y0 }))
      .filter((w) => /^[0-9A-F]{6}$/.test(w.t) && !(/^\d+$/.test(w.t) && otros.includes(w.t)))
      .sort((a, b) => b.h - a.h);
    return { token: cands[0]?.t || '', afiliado: af ? `${af[1]}-${af[2]}-${af[3]}` : '', dni: dniTxt, nombre: nom ? nom[1].replace(/;/g, ',').trim() : '' };
  }

  async function post(accion) {
    const fd = new FormData();
    fd.append('_csrf', raiz.dataset.csrf);
    fd.append('accion', accion);
    fd.append('items', JSON.stringify(items.map(({ token, afiliado, dni, paciente_id, manual }) =>
      ({ token, afiliado, dni, paciente_id: manual ? paciente_id : null }))));
    const r = await fetch(raiz.dataset.url, { method: 'POST', body: fd, credentials: 'same-origin' });
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  }

  async function emparejar() {
    const { items: res, error } = await post('emparejar');
    if (error) throw new Error(error);
    res.forEach((r, i) => Object.assign(items[i], { estado: r.estado, paciente: r.paciente, paciente_id: r.paciente_id, fecha: r.fecha, por: r.por }));
    pintar();
  }

  function pintar() {
    const fecha = (f) => f ? f.split('-').reverse().slice(0, 2).join('/') : '';
    $('tk-lista').innerHTML = items.map((it, i) => {
      const [color, txt] = ESTADOS[it.estado] || ['light', '…'];
      const selPac = it.estado === 'sin_paciente' || it.manual
        ? `<select class="form-select form-select-sm mt-1" data-i="${i}" data-campo="paciente_id"><option value="">— paciente —</option>${
            pacientes.map((p) => `<option value="${p.id}" ${p.id === it.paciente_id ? 'selected' : ''}>${esc(p.n)}</option>`).join('')}</select>` : '';
      return `<div class="card mb-2"><div class="card-body p-2 d-flex gap-2 align-items-start">
        <a href="${it.img}" target="_blank"><img src="${it.img}" alt="" style="width:96px;height:auto;border-radius:6px"></a>
        <div class="flex-grow-1 small">
          <div class="d-flex gap-2 align-items-center">
            <input class="form-control form-control-sm fw-bold" style="max-width:120px;letter-spacing:.08em" value="${esc(it.token)}"
                   data-i="${i}" data-campo="token" autocapitalize="characters" autocomplete="off" spellcheck="false">
            <span class="badge text-bg-${color}">${esc(txt)}</span>
          </div>
          <div class="mt-1">${it.paciente ? `<b>${esc(it.paciente)}</b>` : `<span class="text-muted">${esc(it.nombre || 'Paciente no reconocido')}</span>`}
            ${it.afiliado ? `<span class="text-muted"> · afil. ${esc(it.afiliado)}</span>` : ''}</div>
          ${it.fecha ? `<div>Sesión del ${fecha(it.fecha)}</div>` : ''}
          ${selPac}
        </div></div></div>`;
    }).join('');
    const ok = items.filter((it) => it.estado === 'ok').length;
    $('tk-guardar').classList.toggle('d-none', !ok);
    $('tk-guardar').textContent = ok === 1 ? 'Guardar 1 token' : `Guardar ${ok} tokens`;
    const dup = items.filter((it) => it.estado === 'duplicado').length;
    const pend = items.length - ok - dup;
    $('tk-estado').textContent = items.length ? `${items.length} capturas leídas · ${ok} listas${dup ? ` · ${dup} ya estaban cargadas` : ''}${pend ? ` · ${pend} para revisar` : ''}` : '';
  }

  let espera;
  $('tk-lista').addEventListener('change', (ev) => {
    const el = ev.target.closest('[data-campo]');
    if (!el) return;
    const it = items[+el.dataset.i];
    if (el.dataset.campo === 'token') it.token = el.value.trim().toUpperCase();
    else { it.paciente_id = +el.value || null; it.manual = true; }
    clearTimeout(espera);
    espera = setTimeout(() => emparejar().catch((e) => alert(e.message)), 150);
  });

  $('tk-archivos').addEventListener('change', async (ev) => {
    // Las más viejas primero: el primer token va a la primera sesión del mes
    const archivos = [...ev.target.files].sort((a, b) => a.lastModified - b.lastModified);
    ev.target.value = '';
    if (!archivos.length) return;
    if (!window.Tesseract) { alert('No se pudo cargar el lector de texto. Revisá la conexión a internet.'); return; }
    const est = $('tk-estado');
    est.textContent = 'Preparando el lector…';
    const worker = await Tesseract.createWorker('eng');
    try {
      for (const [n, f] of archivos.entries()) {
        est.textContent = `Leyendo captura ${n + 1} de ${archivos.length}…`;
        const { data } = await worker.recognize(f);
        items.push({ img: URL.createObjectURL(f), ...extraer(data) });
      }
    } finally { await worker.terminate(); }
    est.textContent = 'Buscando pacientes…';
    try { await emparejar(); } catch (e) { est.textContent = ''; alert('Error: ' + e.message); }
  });

  $('tk-guardar').addEventListener('click', async (ev) => {
    ev.target.disabled = true;
    try {
      const r = await post('guardar');
      if (r.error) throw new Error(r.error);
      location.href = r.volver;
    } catch (e) { alert('Error: ' + e.message); ev.target.disabled = false; }
  });
})();

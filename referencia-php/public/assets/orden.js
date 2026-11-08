// Registrar orden OSEP: al elegir la foto, se lee y se completan los campos para revisar
(() => {
  const form = document.getElementById('form-orden');
  const foto = document.getElementById('orden-foto');
  if (!form || !foto) return;
  const estado = document.getElementById('orden-estado');
  const pacientes = JSON.parse(form.dataset.pacientes || '[]');
  const fijo = +form.dataset.fijo || null;
  const campo = (n) => form.elements[n];
  const NOMBRES = { nro_autorizacion: 'N° de autorización', fecha_compra: 'fecha de compra', cantidad: 'cantidad',
    fecha_vencimiento: 'vencimiento', codigo_practica: 'código', paciente_id: 'paciente' };

  function poner(nombre, valor) {
    const el = campo(nombre);
    if (!el || valor === '' || valor == null) return false;
    el.value = valor;
    el.classList.add('bg-warning-subtle'); // completado por el sistema: revisar
    el.addEventListener('input', () => el.classList.remove('bg-warning-subtle'), { once: true });
    return true;
  }

  foto.addEventListener('change', async () => {
    const f = foto.files[0];
    if (!f || !f.type.startsWith('image/')) return;
    if (!window.Tesseract || !window.OrdenOCR) { estado.textContent = 'No se pudo cargar el lector (revisá la conexión). Completá los datos a mano.'; return; }
    estado.className = 'small mt-1 text-primary';
    const worker = await Tesseract.createWorker('spa');
    try {
      const { texto } = await OrdenOCR.leerFotoOrden(f, worker, (m) => { estado.textContent = m; });
      const r = OrdenOCR.parsearOrden(texto, pacientes);
      if (!r.esOrden) { estado.className = 'small mt-1 text-danger'; estado.textContent = 'No parece una orden de OSEP. Completá los datos a mano.'; return; }
      const leidos = [], faltan = [];
      const anotar = (n, ok) => (ok ? leidos : faltan).push(NOMBRES[n]);
      anotar('nro_autorizacion', poner('nro_autorizacion', r.comprobante));
      anotar('fecha_compra', poner('fecha_compra', r.fecha_compra));
      anotar('fecha_vencimiento', poner('fecha_vencimiento', r.fecha_vencimiento));
      anotar('cantidad', poner('cantidad', r.cantidad));
      anotar('codigo_practica', poner('codigo_practica', r.codigo));
      if (r.mes) poner('mes', r.mes);
      let avisoPac = '';
      if (fijo) {
        if (r.paciente_id && r.paciente_id !== fijo) avisoPac = ' ⚠️ La orden parece de otro paciente: ' + (pacientes.find((p) => p.id === r.paciente_id)?.n || '') + '.';
      } else anotar('paciente_id', poner('paciente_id', r.paciente_id));
      estado.className = 'small mt-1 ' + (faltan.length || avisoPac ? 'text-warning-emphasis' : 'text-success');
      estado.textContent = (leidos.length ? 'Leí: ' + leidos.join(', ') + '. ' : '') +
        (faltan.length ? 'Completá a mano: ' + faltan.join(', ') + '. ' : '') +
        (r.vencimiento_estimado ? 'El vencimiento se calculó (un mes desde la compra). ' : '') + 'Revisá lo marcado en amarillo.' + avisoPac;
    } catch (e) {
      estado.className = 'small mt-1 text-danger'; estado.textContent = 'No se pudo leer la foto: ' + e.message + '. Completá los datos a mano.';
    } finally { await worker.terminate(); }
  });
})();

// Copiar al portapapeles al tocar elementos con data-copiar
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-copiar]');
  if (!el) return;
  ev.preventDefault();
  try { await navigator.clipboard.writeText(el.dataset.copiar); } catch (e) {}
  const t = el.innerHTML; el.classList.add('text-success'); el.innerHTML = '✓ copiado';
  setTimeout(() => { el.innerHTML = t; el.classList.remove('text-success'); }, 1100);
});

// Compartir un PDF (en el celular abre el menú para mandarlo por WhatsApp con el archivo adjunto)
async function compartirPdf(url, nombre, texto) {
  try {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], nombre, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: texto });
      return true;
    }
  } catch (e) { if (e.name === 'AbortError') return false; }
  alert('Este dispositivo no permite compartir archivos. Usá "Descargar" y adjuntalo en WhatsApp.');
  return false;
}

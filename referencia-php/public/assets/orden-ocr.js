// Lectura de la orden de OSEP ("Comprobante Autorización") a partir de una foto.
// El OCR se hace en el navegador (Tesseract.js): la foto no sale del dispositivo para leerla.
// Los campos se sacan del texto con reglas tolerantes y la profesional los revisa antes de guardar.
(function (global) {
  const iso = (d, m, a) => `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const valida = (d, m, a) => d >= 1 && d <= 31 && m >= 1 && m <= 12 && a >= 2020 && a <= 2099;
  const unMesDespues = (f) => { const [a, m, d] = f.split('-').map(Number); const x = new Date(Date.UTC(a, m, d)); return x.toISOString().slice(0, 10); };
  const diasEntre = (a, b) => (Date.parse(b) - Date.parse(a)) / 86400000;

  /**
   * Saca los datos de la orden del texto leído.
   * pacientes: [{id, dni, afil}] para reconocer al paciente (el DNI de la orden es el del beneficiario).
   * Devuelve {paciente_id, comprobante, fecha_compra, fecha_vencimiento, codigo, cantidad, mes, esOrden}
   */
  function parsearOrden(texto, pacientes = []) {
    const t = texto.replace(/(?<=\d)[Oo]|[Oo](?=\d)/g, '0');
    const r = { esOrden: /COMPROBANTE|AUTORIZACI|OSEP/i.test(t) };

    const fechas = [];
    for (const m of t.matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/g)) {
      const [d, mm, a] = [+m[1], +m[2], +m[3]];
      if (valida(d, mm, a)) fechas.push(iso(d, mm, a));
    }
    // Fechas posibles: no futuras y de menos de un año (descarta lecturas como 2026 → 2028)
    const hoy = new Date(), tope = new Date(hoy.getTime() + 7 * 86400000).toISOString().slice(0, 10);
    const piso = new Date(hoy.getTime() - 365 * 86400000).toISOString().slice(0, 10);
    const posible = (f) => f >= piso && f <= tope;
    const conHora = [...t.matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\s+\d{1,2}\s*:\s*\d{2}/g)]
      .filter((m) => valida(+m[1], +m[2], +m[3])).map((m) => iso(+m[1], +m[2], +m[3])).filter(posible);
    const votos = {};
    for (const f of fechas.filter(posible)) votos[f] = (votos[f] || 0) + 1;
    const orden = Object.keys(votos).sort();
    // Compra = fecha de emisión (en las órdenes es la misma que la de solicitud, que es la más vieja y la que más se repite)
    const masVotada = orden.slice().sort((a, b) => votos[b] - votos[a] || a.localeCompare(b))[0];
    r.fecha_compra = (conHora.length && votos[conHora.sort()[0]] >= (votos[masVotada] || 0) ? conHora[0] : null) || masVotada || '';
    // Vencimiento: una fecha posterior a la compra dentro de ~45 días; si no se leyó, un mes después (así vienen las órdenes)
    const venc = orden.filter((f) => r.fecha_compra && f > r.fecha_compra && diasEntre(r.fecha_compra, f) <= 45).pop();
    r.fecha_vencimiento = venc || (r.fecha_compra ? unMesDespues(r.fecha_compra) : '');
    r.vencimiento_estimado = !venc && !!r.fecha_compra;
    r.mes = r.fecha_compra.slice(0, 7);

    const cod = t.match(/(?<!\d)(\d{2})\s*[-.]\s*(\d{6})\s*[-.]\s*(\d{2})(?!\d)/);
    r.codigo = cod ? `${cod[1]}-${cod[2]}-${cod[3]}` : '';
    const cant = [...t.matchAll(/(?<![\d$.,])(\d{1,2})[.,]00(?![\d.,])/g)].map((m) => +m[1]).find((n) => n >= 1 && n <= 30);
    r.cantidad = cant || '';

    // Números largos: comprobante y DNI. El que coincide con el DNI de un paciente es el DNI; el otro, el comprobante.
    // (sin los que son el código de práctica leído sin guiones, ej. 33020200)
    const digCod = [...t.matchAll(/(?<!\d)\d{2}\s*[-.]\s*\d{6}\s*[-.]?\s*\d{2}(?!\d)/g)].map((m) => m[0].replace(/\D/g, '')).join(' ') + ' ' + r.codigo.replace(/\D/g, '');
    const largos = [...new Set([...t.matchAll(/(?<!\d)\d{7,9}(?!\d)/g)].map((m) => m[0]))].filter((n) => !digCod.includes(n));
    const dig = (s) => String(s || '').replace(/\D/g, '');
    let pac = pacientes.find((p) => p.dni && largos.includes(dig(p.dni)));
    let dniLeido = pac ? dig(pac.dni) : '';
    if (!pac) {
      // El OCR a veces cambia, agrega o pierde un dígito: se acepta esa diferencia si coincide con un único paciente
      const unaDif = (a, b) => {
        if (Math.abs(a.length - b.length) > 1) return false;
        if (a.length === b.length) return [...a].filter((c, i) => c !== b[i]).length <= 1;
        const [l, c] = a.length > b.length ? [a, b] : [b, a];
        for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === c) return true;
        return false;
      };
      const cand = [];
      for (const p of pacientes) { const d = dig(p.dni); const n = d && largos.find((x) => unaDif(x, d)); if (n) cand.push([p, n]); }
      if (cand.length === 1) { pac = cand[0][0]; dniLeido = cand[0][1]; }
    }
    if (!pac) {
      // Si no, por el número de afiliado (la parte del medio: 6 dígitos), sólo si hay un único paciente con ese número
      const seis = [...t.matchAll(/(?<!\d)\d{5,6}(?!\d)/g)].map((m) => m[0].padStart(6, '0'));
      const cand = pacientes.filter((p) => { const m = dig(p.afil).match(/^\d{2}(\d{6})\d{2}$/); return m && seis.includes(m[1]); });
      if (cand.length === 1) pac = cand[0];
    }
    r.paciente_id = pac ? pac.id : null;
    r.dni_leido = dniLeido; // el número tal como se leyó, para no confundirlo con el comprobante
    r.comprobante = largos.find((n) => n !== r.dni_leido && n.length === 8) || largos.find((n) => n !== r.dni_leido) || '';
    return r;
  }

  /** Lee la foto: prueba las orientaciones, agranda y pasa a gris, y devuelve {texto, confianza}. */
  async function leerFotoOrden(archivo, worker, aviso = () => {}) {
    const img = await createImageBitmap(archivo);
    const giros = img.height > img.width ? [90, -90] : [0, 180];
    const preparar = (giro, escala, nitidez = false) => {
      const rot = Math.abs(giro) === 90;
      const w = Math.round((rot ? img.height : img.width) * escala), h = Math.round((rot ? img.width : img.height) * escala);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.translate(w / 2, h / 2); x.rotate(giro * Math.PI / 180);
      const dw = img.width * escala, dh = img.height * escala;
      x.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      // Gris y estirar el contraste (las fotos de papel salen grisáceas)
      const px = x.getImageData(0, 0, w, h), d = px.data;
      let min = 255, max = 0;
      for (let i = 0; i < d.length; i += 4) { const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; d[i] = g; if (g < min) min = g; if (g > max) max = g; }
      const k = 255 / Math.max(1, max - min);
      for (let i = 0; i < d.length; i += 4) { const g = (d[i] - min) * k; d[i] = d[i + 1] = d[i + 2] = g; }
      if (nitidez) { // filtro de enfoque 3x3 (ayuda con las fotos movidas o inclinadas)
        const src = new Uint8ClampedArray(w * h);
        for (let i = 0; i < src.length; i++) src[i] = d[i * 4];
        for (let yy = 1; yy < h - 1; yy++) for (let xx = 1; xx < w - 1; xx++) {
          const i = yy * w + xx;
          const g = 5 * src[i] - src[i - 1] - src[i + 1] - src[i - w] - src[i + w];
          d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g < 0 ? 0 : g > 255 ? 255 : g;
        }
      }
      x.putImageData(px, 0, 0);
      return c;
    };
    // 1) orientación: lectura rápida en tamaño chico de cada giro y se queda con la de más confianza
    aviso('Buscando la orientación de la foto…');
    let mejor = { giro: giros[0], conf: -1 };
    await worker.setParameters({ tessedit_pageseg_mode: '6' }); // un solo bloque: el que mejor lee estas órdenes
    for (const g of giros) {
      const { data } = await worker.recognize(preparar(g, 1));
      const conf = data.confidence + (/COMPROBANTE|AUTORIZACI|OSEP|Delegaci/i.test(data.text) ? 30 : 0);
      if (conf > mejor.conf) mejor = { giro: g, conf };
    }
    // 2) lectura completa agrandada (las fotos que llegan por WhatsApp son chicas), normal y con enfoque:
    //    cada una acierta campos distintos, así que se juntan los dos textos
    const largo = Math.max(img.width, img.height);
    const escala = Math.min(3, Math.max(1, 3200 / largo));
    aviso('Leyendo la orden (1 de 2)…');
    const a = await worker.recognize(preparar(mejor.giro, escala));
    aviso('Leyendo la orden (2 de 2)…');
    const b = await worker.recognize(preparar(mejor.giro, escala, true));
    return { texto: a.data.text + '\n' + b.data.text, confianza: Math.max(a.data.confidence, b.data.confidence) };
  }

  const api = { parsearOrden, leerFotoOrden };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else global.OrdenOCR = api;
})(typeof window !== 'undefined' ? window : globalThis);

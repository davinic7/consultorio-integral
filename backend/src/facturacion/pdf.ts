import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { urlQr } from './arca.js';

export interface DatosPdfFactura {
  emisor: {
    razonSocial: string;
    cuit: string;
    domicilio: string | null;
    inicioActividades: string | null;
  };
  receptor: { nombre: string; docTipo: number; docNro: string };
  ptoVta: number;
  numero: number;
  fecha: string;
  desde: string;
  hasta: string;
  items: { descripcion: string; cantidad: number; precio: number }[];
  total: number;
  cae: string;
  caeVence: string;
  /** Simulado u homologación: se marca "sin validez fiscal". */
  sinValidez: boolean;
}

const dmy = (f: string) => f.split('-').reverse().join('/');
const pesos = (n: number) =>
  n.toLocaleString('es-AR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
const conGuiones = (cuit: string) =>
  `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;

/**
 * PDF de la Factura C con el formato habitual de ARCA (portado de Pdf.php):
 * encabezado con la letra C, emisor, receptor, ítems, total, CAE y QR.
 */
export async function pdfFactura(d: DatosPdfFactura): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 28 });
  const partes: Buffer[] = [];
  doc.on('data', (b: Buffer) => partes.push(b));
  const fin = new Promise<Buffer>((ok) =>
    doc.on('end', () => ok(Buffer.concat(partes))),
  );

  const X = 28;
  const W = 539;
  doc.lineWidth(0.8);
  // Original
  doc.rect(X, 28, W, 22).stroke();
  doc
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('ORIGINAL', X, 34, { width: W, align: 'center' });
  // Cabecera
  doc.rect(X, 50, W, 130).stroke();
  doc
    .moveTo(X + W / 2, 90)
    .lineTo(X + W / 2, 180)
    .stroke();
  doc.rect(X + W / 2 - 22, 50, 44, 40).stroke();
  doc
    .fontSize(26)
    .text('C', X + W / 2 - 22, 54, { width: 44, align: 'center' });
  doc
    .fontSize(7)
    .text('COD. 011', X + W / 2 - 22, 80, { width: 44, align: 'center' });

  doc
    .fontSize(14)
    .text(d.emisor.razonSocial, X + 8, 62, {
      width: W / 2 - 40,
      align: 'center',
    });
  const fila = (y: number, k: string, v: string, x0: number, ancho: number) => {
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .text(k, x0, y, { continued: true, width: ancho });
    doc.font('Helvetica').text(` ${v}`);
  };
  fila(110, 'Razón Social:', d.emisor.razonSocial, X + 8, W / 2 - 16);
  fila(
    128,
    'Domicilio Comercial:',
    d.emisor.domicilio ?? '—',
    X + 8,
    W / 2 - 16,
  );
  fila(
    156,
    'Condición frente al IVA:',
    'Responsable Monotributo',
    X + 8,
    W / 2 - 16,
  );

  const xd = X + W / 2 + 12;
  doc.font('Helvetica-Bold').fontSize(18).text('FACTURA', xd, 60);
  fila(96, 'Punto de Venta:', String(d.ptoVta).padStart(5, '0'), xd, 120);
  doc
    .font('Helvetica-Bold')
    .fontSize(8)
    .text('Comp. Nro:', xd + 125, 96, { continued: true });
  doc.font('Helvetica').text(` ${String(d.numero).padStart(8, '0')}`);
  fila(112, 'Fecha de Emisión:', dmy(d.fecha), xd, W / 2 - 24);
  fila(128, 'CUIT:', conGuiones(d.emisor.cuit), xd, W / 2 - 24);
  fila(
    144,
    'Fecha de Inicio de Actividades:',
    d.emisor.inicioActividades ? dmy(d.emisor.inicioActividades) : '—',
    xd,
    W / 2 - 24,
  );

  // Período
  doc.rect(X, 184, W, 20).stroke();
  fila(190, 'Período Facturado Desde:', dmy(d.desde), X + 8, 170);
  fila(190, 'Hasta:', dmy(d.hasta), X + 200, 120);
  fila(190, 'Fecha de Vto. para el pago:', dmy(d.fecha), X + 330, 200);

  // Receptor
  doc.rect(X, 208, W, 40).stroke();
  if (d.receptor.docTipo === 96)
    fila(214, 'DNI:', d.receptor.docNro, X + 8, 160);
  else fila(214, 'Documento:', 'Sin identificar', X + 8, 160);
  fila(
    214,
    'Apellido y Nombre / Razón Social:',
    d.receptor.nombre,
    X + 170,
    W - 180,
  );
  fila(230, 'Condición frente al IVA:', 'Consumidor Final', X + 8, 260);
  fila(230, 'Condición de venta:', 'Contado', X + 300, 230);

  // Ítems
  let y = 256;
  doc.rect(X, y, W, 18).fillAndStroke('#e6e6e6', '#000');
  doc.fill('#000').font('Helvetica-Bold').fontSize(8);
  const cols = [
    { t: 'Producto / Servicio', x: X + 6, w: 270, a: 'left' as const },
    { t: 'Cantidad', x: X + 280, w: 60, a: 'right' as const },
    { t: 'Precio Unit.', x: X + 345, w: 90, a: 'right' as const },
    { t: 'Subtotal', x: X + 440, w: 92, a: 'right' as const },
  ];
  for (const c of cols) doc.text(c.t, c.x, y + 5, { width: c.w, align: c.a });
  y += 24;
  doc.font('Helvetica').fontSize(9);
  for (const it of d.items) {
    const vals = [
      it.descripcion,
      pesos(it.cantidad),
      pesos(it.precio),
      pesos(it.cantidad * it.precio),
    ];
    cols.forEach((c, i) =>
      doc.text(vals[i]!, c.x, y, { width: c.w, align: c.a }),
    );
    y += 18;
  }

  // Totales
  const yt = 620;
  doc.rect(X, yt, W, 60).stroke();
  doc.font('Helvetica-Bold').fontSize(9);
  doc.text('Subtotal: $', X + 300, yt + 10, { width: 140, align: 'right' });
  doc.text(pesos(d.total), X + 440, yt + 10, { width: 92, align: 'right' });
  doc.text('Importe Otros Tributos: $', X + 300, yt + 24, {
    width: 140,
    align: 'right',
  });
  doc.text('0,00', X + 440, yt + 24, { width: 92, align: 'right' });
  doc
    .fontSize(11)
    .text('Importe Total: $', X + 300, yt + 40, { width: 140, align: 'right' });
  doc.text(pesos(d.total), X + 440, yt + 40, { width: 92, align: 'right' });

  // CAE y QR
  const qr = await QRCode.toBuffer(
    urlQr({
      fecha: d.fecha,
      cuit: d.emisor.cuit,
      ptoVta: d.ptoVta,
      numero: d.numero,
      total: d.total,
      docTipo: d.receptor.docTipo,
      docNro: d.receptor.docNro,
      cae: d.cae,
    }),
    { margin: 0, width: 220 },
  );
  doc.image(qr, X, 692, { width: 90 });
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text('Comprobante Autorizado', X + 100, 700);
  if (d.sinValidez) {
    doc
      .fillColor('#b00020')
      .text('SIN VALIDEZ FISCAL (prueba)', X + 100, 716)
      .fillColor('#000');
  }
  fila(700, 'CAE N°:', d.cae, X + 340, 200);
  fila(716, 'Fecha de Vto. de CAE:', dmy(d.caeVence), X + 340, 200);

  doc.end();
  return fin;
}

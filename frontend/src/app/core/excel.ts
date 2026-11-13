/**
 * Libros de Excel (.xlsx) armados en el navegador, sin librerías: un .xlsx es un zip
 * de XML. Se arma con lo que ya está en pantalla, así que no sale nada del dispositivo.
 * Los textos van como texto en línea: Excel nunca los interpreta como fórmulas.
 */

export type Formato = 'texto' | 'entero' | 'plata' | 'porcentaje';

/** Valor de una celda; con `formato` propio cuando no sigue el de su columna. */
export type Celda = string | number | null | { valor: number | null; formato: Formato };

export interface Columna {
  titulo: string;
  formato?: Formato;
  /** Ancho en caracteres. */
  ancho?: number;
}

export interface Hoja {
  nombre: string;
  columnas: Columna[];
  filas: Celda[][];
  /** Última fila, en negrita. */
  total?: Celda[];
}

export const TIPO_EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const FORMATOS: Formato[] = ['texto', 'entero', 'plata', 'porcentaje'];
/** Formatos numéricos de Excel: general, 1.234, 1.234,56 y 12%. */
const NUM_FMT: Record<Formato, number> = { texto: 0, entero: 3, plata: 4, porcentaje: 9 };
const ANCHO: Record<Formato, number> = { texto: 26, entero: 12, plata: 16, porcentaje: 12 };

/** Estilo de la celda: uno por formato, y su par en negrita. */
const estilo = (f: Formato, negrita: boolean) => FORMATOS.indexOf(f) * 2 + (negrita ? 1 : 0);

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006';

function escapar(s: string): string {
  return (
    s
      // Caracteres de control que XML no admite.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

/** 0 → "A", 26 → "AA". */
export function letraColumna(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

/** Excel no admite nombres de hoja de más de 31 caracteres ni con []:*?/\ */
function nombreDeHoja(nombre: string, usados: Set<string>): string {
  const base =
    nombre
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim()
      .slice(0, 31)
      .trim() || 'Hoja';
  let final = base;
  for (let n = 2; usados.has(final.toLowerCase()); n++) {
    const sufijo = ` (${n})`;
    final = base.slice(0, 31 - sufijo.length) + sufijo;
  }
  usados.add(final.toLowerCase());
  return final;
}

function celda(ref: string, c: Celda, formatoColumna: Formato, negrita: boolean): string {
  const propio = typeof c === 'object' && c !== null;
  const valor = propio ? c.valor : c;
  const formato = propio ? c.formato : formatoColumna;
  if (valor === null || valor === '') return '';
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return '';
    return `<c r="${ref}" s="${estilo(formato, negrita)}"><v>${valor}</v></c>`;
  }
  return `<c r="${ref}" s="${estilo('texto', negrita)}" t="inlineStr"><is><t xml:space="preserve">${escapar(valor)}</t></is></c>`;
}

function xmlDeHoja(h: Hoja): string {
  const fila = (n: number, celdas: Celda[], negrita: boolean) =>
    `<row r="${n}">${celdas
      .map((c, i) => celda(`${letraColumna(i)}${n}`, c, h.columnas[i]?.formato ?? 'texto', negrita))
      .join('')}</row>`;
  const filas = [
    fila(
      1,
      h.columnas.map((c) => c.titulo),
      true,
    ),
    ...h.filas.map((f, i) => fila(i + 2, f, false)),
    ...(h.total ? [fila(h.filas.length + 2, h.total, true)] : []),
  ];
  const cols = h.columnas
    .map((c, i) => {
      const ancho = c.ancho ?? Math.max(ANCHO[c.formato ?? 'texto'], c.titulo.length + 2);
      return `<col min="${i + 1}" max="${i + 1}" width="${ancho}" customWidth="1"/>`;
    })
    .join('');
  return (
    `${XML}<worksheet xmlns="${NS}">` +
    // La fila de títulos queda fija al bajar.
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${cols}</cols><sheetData>${filas.join('')}</sheetData></worksheet>`
  );
}

function xmlDeEstilos(): string {
  const xfs = FORMATOS.flatMap((f) =>
    [0, 1].map(
      (fuente) =>
        `<xf numFmtId="${NUM_FMT[f]}" fontId="${fuente}" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>`,
    ),
  );
  return (
    `${XML}<styleSheet xmlns="${NS}">` +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
    '</styleSheet>'
  );
}

/** Las partes del .xlsx: ruta dentro del zip y su XML. */
export function partesDelLibro(hojas: Hoja[]): { ruta: string; xml: string }[] {
  if (!hojas.length) throw new Error('El libro necesita al menos una hoja');
  const usados = new Set<string>();
  const nombres = hojas.map((h) => nombreDeHoja(h.nombre, usados));
  const tipo = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
  return [
    {
      ruta: '[Content_Types].xml',
      xml:
        `${XML}<Types xmlns="${PKG}/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        `<Override PartName="/xl/workbook.xml" ContentType="${tipo}.sheet.main+xml"/>` +
        `<Override PartName="/xl/styles.xml" ContentType="${tipo}.styles+xml"/>` +
        hojas
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${tipo}.worksheet+xml"/>`,
          )
          .join('') +
        '</Types>',
    },
    {
      ruta: '_rels/.rels',
      xml: `${XML}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      ruta: 'xl/workbook.xml',
      xml:
        `${XML}<workbook xmlns="${NS}" xmlns:r="${REL}"><bookViews><workbookView/></bookViews><sheets>` +
        nombres
          .map((n, i) => `<sheet name="${escapar(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join('') +
        '</sheets></workbook>',
    },
    {
      ruta: 'xl/_rels/workbook.xml.rels',
      xml:
        `${XML}<Relationships xmlns="${PKG}/relationships">` +
        hojas
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
          )
          .join('') +
        `<Relationship Id="rId${hojas.length + 1}" Type="${REL}/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    { ruta: 'xl/styles.xml', xml: xmlDeEstilos() },
    ...hojas.map((h, i) => ({ ruta: `xl/worksheets/sheet${i + 1}.xml`, xml: xmlDeHoja(h) })),
  ];
}

// ───────── Zip sin compresión ─────────

const TABLA_CRC = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of datos) c = TABLA_CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Zip "guardado" (sin comprimir): alcanza para planillas chicas y no pide librerías. */
export function zip(archivos: { ruta: string; datos: Uint8Array }[]): Uint8Array {
  const texto = new TextEncoder();
  const locales: Uint8Array[] = [];
  const centrales: Uint8Array[] = [];
  let posicion = 0;
  for (const a of archivos) {
    const nombre = texto.encode(a.ruta);
    const crc = crc32(a.datos);
    const comun = (v: DataView, p: number) => {
      v.setUint16(p, 20, true); // versión necesaria
      v.setUint16(p + 2, 0x0800, true); // nombres en UTF-8
      v.setUint16(p + 4, 0, true); // sin compresión
      v.setUint16(p + 6, 0, true); // hora
      v.setUint16(p + 8, 0x21, true); // fecha fija: 1/1/1980
      v.setUint32(p + 10, crc, true);
      v.setUint32(p + 14, a.datos.length, true);
      v.setUint32(p + 18, a.datos.length, true);
      v.setUint16(p + 22, nombre.length, true);
    };
    const local = new Uint8Array(30 + nombre.length);
    const vl = new DataView(local.buffer);
    vl.setUint32(0, 0x04034b50, true);
    comun(vl, 4);
    local.set(nombre, 30);

    const central = new Uint8Array(46 + nombre.length);
    const vc = new DataView(central.buffer);
    vc.setUint32(0, 0x02014b50, true);
    vc.setUint16(4, 20, true); // versión que lo creó
    comun(vc, 6);
    vc.setUint32(42, posicion, true);
    central.set(nombre, 46);

    locales.push(local, a.datos);
    centrales.push(central);
    posicion += local.length + a.datos.length;
  }
  const largoCentral = centrales.reduce((n, c) => n + c.length, 0);
  const fin = new Uint8Array(22);
  const vf = new DataView(fin.buffer);
  vf.setUint32(0, 0x06054b50, true);
  vf.setUint16(8, archivos.length, true);
  vf.setUint16(10, archivos.length, true);
  vf.setUint32(12, largoCentral, true);
  vf.setUint32(16, posicion, true);

  const salida = new Uint8Array(posicion + largoCentral + fin.length);
  let p = 0;
  for (const parte of [...locales, ...centrales, fin]) {
    salida.set(parte, p);
    p += parte.length;
  }
  return salida;
}

export function libroExcel(hojas: Hoja[]): Uint8Array {
  const texto = new TextEncoder();
  return zip(partesDelLibro(hojas).map((p) => ({ ruta: p.ruta, datos: texto.encode(p.xml) })));
}

/** Arma el libro y lo baja con ese nombre (sin extensión). */
export function descargarExcel(nombre: string, hojas: Hoja[]): void {
  const blob = new Blob([libroExcel(hojas) as BlobPart], { type: TIPO_EXCEL });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${nombre}.xlsx`;
  a.click();
  // El navegador ya tomó el archivo: se libera la memoria.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

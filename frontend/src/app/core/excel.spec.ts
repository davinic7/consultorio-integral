import {
  crc32,
  descargarExcel,
  letraColumna,
  libroExcel,
  partesDelLibro,
  TIPO_EXCEL,
  zip,
  type Hoja,
} from './excel';

const HOJA: Hoja = {
  nombre: 'Por mes',
  columnas: [
    { titulo: 'Mes' },
    { titulo: 'Turnos', formato: 'entero' },
    { titulo: 'Asistencia', formato: 'porcentaje' },
    { titulo: 'Facturado', formato: 'plata' },
  ],
  filas: [
    ['Octubre 2026', 4, 0.75, 28000.5],
    ['Noviembre 2026', 0, null, 0],
  ],
  total: ['Total', 4, 0.75, 28000.5],
};

/** Lee un zip sin compresión: nombre y contenido de cada archivo. */
function leerZip(z: Uint8Array): Map<string, string> {
  const v = new DataView(z.buffer, z.byteOffset, z.byteLength);
  const fin = z.length - 22;
  expect(v.getUint32(fin, true)).toBe(0x06054b50);
  const cantidad = v.getUint16(fin + 10, true);
  let p = v.getUint32(fin + 16, true);
  const texto = new TextDecoder();
  const archivos = new Map<string, string>();
  for (let i = 0; i < cantidad; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const crc = v.getUint32(p + 16, true);
    const largo = v.getUint32(p + 24, true);
    const largoNombre = v.getUint16(p + 28, true);
    const local = v.getUint32(p + 42, true);
    const nombre = texto.decode(z.subarray(p + 46, p + 46 + largoNombre));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const inicio = local + 30 + v.getUint16(local + 26, true);
    const datos = z.subarray(inicio, inicio + largo);
    expect(crc32(datos)).toBe(crc);
    archivos.set(nombre, texto.decode(datos));
    p += 46 + largoNombre;
  }
  return archivos;
}

const hoja1 = (hojas: Hoja[]) =>
  partesDelLibro(hojas).find((p) => p.ruta === 'xl/worksheets/sheet1.xml')!.xml;

describe('excel', () => {
  it('letraColumna y crc32', () => {
    expect([0, 25, 26, 27, 701, 702].map(letraColumna)).toEqual([
      'A',
      'Z',
      'AA',
      'AB',
      'ZZ',
      'AAA',
    ]);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('arma la hoja con títulos en negrita, números con formato y total', () => {
    const xml = hoja1([HOJA]);
    // Títulos: texto en negrita (estilo 1).
    expect(xml).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Mes</t>');
    // Entero (estilo 2), porcentaje (6) y plata (4), como números.
    expect(xml).toContain('<c r="B2" s="2"><v>4</v></c>');
    expect(xml).toContain('<c r="C2" s="6"><v>0.75</v></c>');
    expect(xml).toContain('<c r="D2" s="4"><v>28000.5</v></c>');
    // El cero se escribe; lo que no hay, no.
    expect(xml).toContain('<c r="B3" s="2"><v>0</v></c>');
    expect(xml).not.toContain('r="C3"');
    // Total en negrita.
    expect(xml).toContain('<c r="A4" s="1" t="inlineStr">');
    expect(xml).toContain('<c r="D4" s="5"><v>28000.5</v></c>');
    expect(xml).toContain('state="frozen"');
  });

  it('una celda puede llevar su propio formato', () => {
    const xml = hoja1([
      {
        nombre: 'Resumen',
        columnas: [{ titulo: 'Dato' }, { titulo: 'Valor', formato: 'entero' }],
        filas: [
          ['Facturado', { valor: 1500, formato: 'plata' }],
          ['Asistencia', { valor: null, formato: 'porcentaje' }],
        ],
      },
    ]);
    expect(xml).toContain('<c r="B2" s="4"><v>1500</v></c>');
    expect(xml).not.toContain('r="B3"');
  });

  it('los textos van escapados y nunca como fórmula', () => {
    const xml = hoja1([
      {
        nombre: 'x',
        columnas: [{ titulo: 'Nombre' }],
        filas: [['=SUMA(A1) <b> & "Díaz"\u0001'], [Number.NaN]],
      },
    ]);
    expect(xml).toContain('>=SUMA(A1) &lt;b&gt; &amp; &quot;Díaz&quot;</t>');
    expect(xml).not.toContain('<f>');
    expect(xml).not.toContain('NaN');
  });

  it('corrige los nombres de hoja que Excel no admite', () => {
    const libro = partesDelLibro([
      {
        nombre: 'Liquidación: Noviembre/2026 de un centro con nombre largo',
        columnas: [],
        filas: [],
      },
      { nombre: 'Resumen', columnas: [], filas: [] },
      { nombre: 'resumen', columnas: [], filas: [] },
    ]).find((p) => p.ruta === 'xl/workbook.xml')!.xml;
    const nombres = [...libro.matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1]!);
    expect(nombres).toEqual(['Liquidación  Noviembre 2026 de', 'Resumen', 'resumen (2)']);
    expect(nombres.every((n) => n.length <= 31)).toBe(true);
    expect(() => partesDelLibro([])).toThrow();
  });

  it('el libro es un zip con todas las partes de un .xlsx', () => {
    const archivos = leerZip(libroExcel([HOJA, { ...HOJA, nombre: 'Otra' }]));
    expect([...archivos.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
    expect(archivos.get('[Content_Types].xml')).toContain('/xl/worksheets/sheet2.xml');
    expect(archivos.get('xl/workbook.xml')).toContain(
      '<sheet name="Otra" sheetId="2" r:id="rId2"/>',
    );
    expect(archivos.get('xl/_rels/workbook.xml.rels')).toContain('Id="rId3"');
    expect(archivos.get('xl/styles.xml')).toContain('<cellXfs count="8">');
    expect(archivos.get('xl/worksheets/sheet1.xml')).toContain('Octubre 2026');
  });

  it('el zip guarda nombres y contenido con acentos', () => {
    const datos = new TextEncoder().encode('Liquidación');
    const archivos = leerZip(zip([{ ruta: 'año.txt', datos }]));
    expect(archivos.get('año.txt')).toBe('Liquidación');
  });

  it('descargarExcel baja el archivo con extensión .xlsx', () => {
    const crear = vi.fn<(b: Blob) => string>().mockReturnValue('blob:prueba');
    const original = URL.createObjectURL;
    URL.createObjectURL = crear;
    let bajado = '';
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      bajado = this.download;
    });
    try {
      descargarExcel('reporte-2026-10-a-2026-11', [HOJA]);
      expect(click).toHaveBeenCalledOnce();
      expect(bajado).toBe('reporte-2026-10-a-2026-11.xlsx');
      expect(crear.mock.calls[0]![0].type).toBe(TIPO_EXCEL);
    } finally {
      click.mockRestore();
      URL.createObjectURL = original;
    }
  });
});

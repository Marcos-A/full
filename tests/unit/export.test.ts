import { describe, expect, it } from 'vitest';
import { exportName } from '../../src/export/names';
import {
  buildXlsx,
  cellRef,
  columnTypes,
  columnWidthChars,
  decimalMark,
  escapeCellText,
  isNumeric,
  readRows,
  sheetName,
  XlsxLimitError,
} from '../../src/export/xlsx';
import { crc32, dosDateTime, zip } from '../../src/export/zip';

/** Reads a ZIP back with DecompressionStream, checking each entry's CRC and size on the way. */
async function unzip(bytes: Uint8Array): Promise<Map<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed = view.getUint32(at + 20, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
    const data = bytes.subarray(start, start + compressed);
    let raw: Uint8Array;
    if (method === 8) {
      const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      raw = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      expect(method).toBe(0);
      raw = data;
    }
    expect(raw.length, name).toBe(size);
    expect(crc32(raw), name).toBe(crc);
    files.set(name, new TextDecoder().decode(raw));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}

describe('XLSX numbers', () => {
  it.each([
    ['0', '.', true],
    ['-3', '.', true],
    ['1.5', '.', true],
    ['1.5', ',', false],
    ['1,5', ',', true],
    ['1,5', '.', false],
    ['007', '.', false],
    ['0.5', '.', true],
    ['+1', '.', false],
    ['1 000', '.', false],
    [' 12', '.', false],
    ['1.000,50', ',', false],
    ['1,000.50', '.', false],
    ['1E5', '.', false],
    ['1234567890123456', '.', false],
    ['123456789012345', '.', true],
    ['0.000000000000001', '.', true],
    ['12%', '.', false],
    ['€5', '.', false],
    ['2026-01-01', '.', false],
    ['12:30', '.', false],
    ['TRUE', '.', false],
    ['', '.', false],
  ] as const)('%j with %j as the decimal mark: %j', (value, mark, expected) => {
    expect(isNumeric(value, mark)).toBe(expected);
  });

  it('chooses the comma only when it cannot be the delimiter, some value uses it, and none uses a dot', () => {
    expect(decimalMark(['1,5', '2'], ';')).toBe(',');
    expect(decimalMark(['1,5', '2'], '\t')).toBe(',');
    expect(decimalMark(['1,5', '2'], ',')).toBe('.');
    expect(decimalMark(['1,5', '2.5'], ';')).toBe('.');
    expect(decimalMark(['1', '2'], ';')).toBe('.');
  });

  it('keeps a column as text if one cell below the first row is not a number', () => {
    const rows = [['code', 'n'], ['08001', '1'], ['08002', '2'], ['x', '']];
    expect(columnTypes(rows, true, '.').map((t) => t.numeric)).toEqual([false, true]);
  });

  it('does not count a text first row, whether or not it shows as the header', () => {
    const rows = [['amount'], ['1'], ['2']];
    expect(columnTypes(rows, true, '.')[0].numeric).toBe(true);
    expect(columnTypes(rows, false, '.')[0].numeric).toBe(true);
  });

  it('counts a numeric first row when the header row is off, but not as data when it is on', () => {
    expect(columnTypes([['5'], ['x']], false, '.')[0].numeric).toBe(false);
    expect(columnTypes([['5']], false, '.')[0].numeric).toBe(true);
    expect(columnTypes([['5']], true, '.')[0].numeric).toBe(false);
  });

  it('keeps trailing zeros where the whole column shares its decimals, and uses General otherwise', () => {
    expect(columnTypes([['a'], ['1.50'], ['2.75']], true, '.')[0]).toEqual({ numeric: true, decimals: 2 });
    expect(columnTypes([['a'], ['1.5'], ['2.75']], true, '.')[0]).toEqual({ numeric: true, decimals: null });
    expect(columnTypes([['a'], ['1'], ['2']], true, '.')[0]).toEqual({ numeric: true, decimals: 0 });
  });
});

describe('XLSX text and names', () => {
  it('escapes XML, and writes what XML cannot hold as _xHHHH_', () => {
    expect(escapeCellText('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
    expect(escapeCellText('bell\u0007')).toBe('bell_x0007_');
    expect(escapeCellText('tab\tline\nok')).toBe('tab\tline\nok');
    expect(escapeCellText('literal _x0041_')).toBe('literal _x005F_x0041_');
    expect(escapeCellText('lone \uD800 surrogate')).toBe('lone _xD800_ surrogate');
    expect(escapeCellText('emoji 😀')).toBe('emoji 😀');
  });

  it('makes a sheet name Excel accepts', () => {
    expect(sheetName('sales.csv')).toBe('sales');
    expect(sheetName('a:b\\c/d?e*f[g].csv')).toBe('abcdefg');
    expect(sheetName("'quoted'.csv")).toBe('quoted');
    expect(sheetName('History.csv')).toBe('Sheet1');
    expect(sheetName('[].csv')).toBe('Sheet1');
    expect(sheetName(`${'x'.repeat(40)}.csv`)).toHaveLength(31);
  });

  it('converts pixel widths to Excel characters', () => {
    expect(columnWidthChars(70)).toBe(10);
    expect(columnWidthChars(0)).toBe(1);
  });

  it('names cells as Excel does', () => {
    expect(cellRef(0, 0)).toBe('A1');
    expect(cellRef(9, 25)).toBe('Z10');
    expect(cellRef(0, 26)).toBe('AA1');
    expect(cellRef(0, 16_383)).toBe('XFD1');
  });

  it('suggests the same name with the new extension', () => {
    expect(exportName('notes.md', 'html')).toBe('notes.html');
    expect(exportName('data.csv', 'xlsx')).toBe('data.xlsx');
    expect(exportName('untitled', 'html')).toBe('untitled.html');
    expect(exportName('.env', 'html')).toBe('.env.html');
  });

  it('refuses what Excel could not open, naming the cell', () => {
    expect(() => readRows(`a,b\n1,${'x'.repeat(32_768)}\n`, ',')).toThrow(XlsxLimitError);
    try {
      readRows(`a,b\n1,${'x'.repeat(32_768)}\n`, ',');
    } catch (error) {
      expect((error as XlsxLimitError).detail).toEqual({ limit: 'cell', cell: 'B2' });
    }
    expect(() => readRows(`${'a,'.repeat(16_384)}a\n`, ',')).toThrow(XlsxLimitError);
  });
});

describe('ZIP', () => {
  it('reads back with matching CRCs and sizes', async () => {
    const encoder = new TextEncoder();
    const bytes = await zip([
      { name: 'a.txt', chunks: [encoder.encode('hello '), encoder.encode('world')] },
      { name: 'dir/b.txt', chunks: [encoder.encode('x'.repeat(10_000))] },
      { name: 'empty', chunks: [] },
    ]);
    const files = await unzip(bytes);
    expect(files.get('a.txt')).toBe('hello world');
    expect(files.get('dir/b.txt')).toBe('x'.repeat(10_000));
    expect(files.get('empty')).toBe('');
    expect(bytes.length).toBeLessThan(10_000);
  });

  it('computes the standard CRC-32 and DOS dates', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(dosDateTime(new Date(2026, 10, 12, 14, 30, 10))).toEqual({
      time: (14 << 11) | (30 << 5) | 5,
      date: ((2026 - 1980) << 9) | (11 << 5) | 12,
    });
  });
});

describe('XLSX workbook', () => {
  const build = (text: string, extra: Partial<Parameters<typeof buildXlsx>[0]> = {}) =>
    buildXlsx({ text, delimiter: ';', headerRow: true, columnWidths: [], fileName: 'data.csv', ...extra }).then(unzip);

  it('has the six parts and nothing else', async () => {
    const files = await build('a;b\r\n1;2\r\n');
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="data"');
  });

  it('writes numbers from their digits, text as inline strings, and the header in bold above a frozen pane', async () => {
    const sheet = (await build('code;amount;note\r\n007;1,50;=SUM(A1)\r\n008;2,25;"two\r\nlines"\r\n')).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<dimension ref="A1:C3"/>');
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">code</t></is></c>');
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">007</t></is></c>');
    expect(sheet).toContain('<c r="B2" s="3"><v>1.50</v></c>');
    expect(sheet).toContain('<c r="C2" t="inlineStr"><is><t xml:space="preserve">=SUM(A1)</t></is></c>');
    expect(sheet).toContain('<c r="C3" t="inlineStr" s="2"><is><t xml:space="preserve">two\nlines</t></is></c>');
    expect(sheet).not.toContain('<f>');
  });

  it('leaves empty cells out, and sizes columns from the grid', async () => {
    const sheet = (await build('a;b;c\r\n1;;3\r\n', { columnWidths: [70, 140, 35] })).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).not.toContain('r="B2"');
    expect(sheet).toContain('<col min="2" max="2" width="20" customWidth="1"/>');
  });

  it('writes the first row as data when the header row is off and it is numeric', async () => {
    const sheet = (await build('1;2\r\n3;4\r\n', { headerRow: false })).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="A1"><v>1</v></c>');
    expect(sheet).not.toContain('frozen');
  });

  it('handles 100,000 rows', async () => {
    const lines = ['id,name,amount'];
    for (let i = 0; i < 100_000; i++) lines.push(`${i},Name ${i},${i}.5`);
    const files = await build(lines.join('\n') + '\n', { delimiter: ',' });
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet.match(/<row /g)).toHaveLength(100_001);
    expect(sheet).toContain('<c r="C100001" s="3"><v>99999.5</v></c>');
  }, 30_000);
});

import { fieldValue, parseCsv } from '../core/csv';
import { zip } from './zip';

/**
 * CSV to XLSX, with no dependency. Runs on a worker (xlsxWorker.ts), and only falls back to the
 * main thread if the worker can't start. Numbers are detected by column, conservatively: anything
 * that might be an ID, a code, a date or a formatted amount stays text, so Excel never changes it.
 */

export interface XlsxInput {
  text: string;
  delimiter: string;
  headerRow: boolean;
  /** In pixels, as the grid draws them. Empty when no column was ever sized. */
  columnWidths: number[];
  /** The file's name, from which the sheet's name is made. */
  fileName: string;
}

export type XlsxLimit = { limit: 'rows' } | { limit: 'columns' } | { limit: 'cell'; cell: string };

/** Excel can't open the file at all past these, so the export is refused rather than truncated. */
export const MAX_ROWS = 1_048_576;
export const MAX_COLUMNS = 16_384;
export const MAX_CELL_CHARS = 32_767;
/** Excel keeps 15 significant digits, so a longer number (an ID, a card number) would change. */
const MAX_DIGITS = 15;

export class XlsxLimitError extends Error {
  constructor(readonly detail: XlsxLimit) {
    super(`XLSX limit: ${detail.limit}`);
  }
}

export type DecimalMark = '.' | ',';

const NUMBER = { '.': /^-?(0|[1-9]\d*)(\.\d+)?$/, ',': /^-?(0|[1-9]\d*)(,\d+)?$/ };
const LOOKS_COMMA = /^-?(0|[1-9]\d*),\d+$/;
const LOOKS_DOT = /^-?(0|[1-9]\d*)\.\d+$/;

/** Whether the value is a plain number in this file's decimal mark, short enough for Excel to keep exactly. */
export function isNumeric(value: string, decimal: DecimalMark): boolean {
  if (!NUMBER[decimal].test(value)) return false;
  const digits = value.replace(/[-.,]/g, '').replace(/^0+/, '');
  return digits.length <= MAX_DIGITS;
}

/** A comma only where it can't be the delimiter, at least one value uses it, and no value uses a dot. */
export function decimalMark(values: Iterable<string>, delimiter: string): DecimalMark {
  if (delimiter === ',') return '.';
  let comma = false;
  for (const value of values) {
    if (LOOKS_DOT.test(value)) return '.';
    if (!comma && LOOKS_COMMA.test(value)) comma = true;
  }
  return comma ? ',' : '.';
}

export interface ColumnType {
  numeric: boolean;
  /** The decimals every number in the column shares, so `1.50` keeps showing as `1.50`. Null when mixed. */
  decimals: number | null;
}

const decimalsOf = (value: string): number => {
  const mark = Math.max(value.indexOf('.'), value.indexOf(','));
  return mark < 0 ? 0 : value.length - mark - 1;
};

/**
 * A column is numeric when every non-empty cell below the first row is a number. The first row
 * only counts when it's a number itself and the header row is off; otherwise it's most likely a
 * header, shown or not, and is written as text above the numbers.
 */
export function columnTypes(rows: readonly (readonly string[])[], headerRow: boolean, decimal: DecimalMark): ColumnType[] {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const types: ColumnType[] = [];
  for (let col = 0; col < width; col++) {
    let numeric = true;
    let seen = false;
    let decimals: number | null | undefined;
    for (let r = 0; r < rows.length && numeric; r++) {
      const value = rows[r][col] ?? '';
      if (value === '') continue;
      const isNumber = isNumeric(value, decimal);
      if (r === 0 && (headerRow || !isNumber)) continue;
      if (!isNumber) {
        numeric = false;
        break;
      }
      seen = true;
      const places = decimalsOf(value);
      decimals = decimals === undefined ? places : decimals === places ? decimals : null;
    }
    numeric &&= seen;
    types.push({ numeric, decimals: !numeric ? null : decimals === undefined ? 0 : decimals });
  }
  return types;
}

/** The sheet's name: Excel allows 31 characters, none of `: \ / ? * [ ]`, no apostrophe at either end, and not "History". */
export function sheetName(fileName: string): string {
  const stem = fileName.replace(/\.[^.]*$/, '');
  let name = Array.from(stem.replace(/[:\\/?*[\]]/g, ''))
    .slice(0, 31)
    .join('')
    .replace(/^'+|'+$/g, '')
    .trim();
  if (name.toLowerCase() === 'history') name = '';
  return name || 'Sheet1';
}

/** Excel's column width is in characters of its default font, roughly 7 pixels each. */
export function columnWidthChars(px: number): number {
  return Math.round((Math.max(px, 7) / 7) * 100) / 100;
}

/** A1-style reference. */
export function cellRef(row: number, col: number): string {
  let letters = '';
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `${letters}${row + 1}`;
}

// Characters XML 1.0 can't hold, lone surrogates, and text that would read as one of Excel's escapes.
const UNSAFE = /[\x00-\x08\x0B\x0C\x0E-\x1F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|_x[0-9A-Fa-f]{4}_/g;

/** Text for a cell: XML-escaped, with what XML can't hold written as Excel's `_xHHHH_`. */
export function escapeCellText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(UNSAFE, (match) =>
      match.length === 1 ? `_x${match.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}_` : `_x005F${match}`,
    );
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// Fixed styles: 0 default, 1 bold header, 2 wrapped text, then one per decimal count in use.
const STYLE_BOLD = 1;
const STYLE_WRAP = 2;
const FIRST_DECIMAL_STYLE = 3;

function stylesXml(decimalCounts: number[]): string {
  const formats = decimalCounts.map((d, i) => `<numFmt numFmtId="${164 + i}" formatCode="0.${'0'.repeat(d)}"/>`).join('');
  const numberXfs = decimalCounts
    .map((_, i) => `<xf numFmtId="${164 + i}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>`)
    .join('');
  return (
    XML_HEAD +
    `<styleSheet xmlns="${MAIN_NS}">` +
    (decimalCounts.length ? `<numFmts count="${decimalCounts.length}">${formats}</numFmts>` : '') +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    `<cellXfs count="${FIRST_DECIMAL_STYLE + decimalCounts.length}">` +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
    numberXfs +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>'
  );
}

const CONTENT_TYPES =
  XML_HEAD +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
  '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
  '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
  '</Types>';

const ROOT_RELS =
  XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
  '</Relationships>';

const WORKBOOK_RELS =
  XML_HEAD +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
  '</Relationships>';

const workbookXml = (name: string) =>
  XML_HEAD +
  `<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}">` +
  `<sheets><sheet name="${escapeAttribute(name)}" sheetId="1" r:id="rId1"/></sheets>` +
  '</workbook>';

/** Rows of values, after checking every limit Excel has. */
export function readRows(text: string, delimiter: string): string[][] {
  const parsed = parseCsv(text, delimiter);
  if (parsed.error) throw new Error(`Malformed CSV near line ${parsed.error.line}`);
  // A final line ending ends the last row; it doesn't start an empty one.
  const rows = parsed.rows.map((row) => row.fields.map(fieldValue));
  if (rows.length > MAX_ROWS) throw new XlsxLimitError({ limit: 'rows' });
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (row.length > MAX_COLUMNS) throw new XlsxLimitError({ limit: 'columns' });
    for (let c = 0; c < row.length; c++) {
      if (row[c].length > MAX_CELL_CHARS) throw new XlsxLimitError({ limit: 'cell', cell: cellRef(r, c) });
    }
  }
  return rows;
}

const ROWS_PER_CHUNK = 2000;

function* sheetChunks(
  rows: string[][],
  types: ColumnType[],
  input: XlsxInput & { decimal: DecimalMark },
  decimalStyle: Map<number, number>,
) {
  const encoder = new TextEncoder();
  const width = types.length;
  const last = rows.length > 0 && width > 0 ? cellRef(rows.length - 1, width - 1) : 'A1';
  let head = XML_HEAD + `<worksheet xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><dimension ref="A1${last === 'A1' ? '' : `:${last}`}"/>`;
  head += input.headerRow && rows.length > 0
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  head += '<sheetFormatPr defaultRowHeight="15"/>';
  const widths = input.columnWidths.slice(0, width);
  if (widths.length > 0) {
    head += '<cols>';
    widths.forEach((px, i) => {
      head += `<col min="${i + 1}" max="${i + 1}" width="${columnWidthChars(px)}" customWidth="1"/>`;
    });
    head += '</cols>';
  }
  head += '<sheetData>';
  yield encoder.encode(head);

  let xml = '';
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const header = input.headerRow && r === 0;
    xml += `<row r="${r + 1}">`;
    for (let c = 0; c < row.length; c++) {
      const value = row[c];
      if (value === '') continue;
      const ref = cellRef(r, c);
      const type = types[c];
      if (!header && type.numeric && isNumeric(value, input.decimal)) {
        const style = type.decimals ? decimalStyle.get(type.decimals) : undefined;
        xml += `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value.replace(',', '.')}</v></c>`;
      } else {
        const text = value.includes('\r') ? value.replace(/\r\n?/g, '\n') : value;
        const style = header ? STYLE_BOLD : text.includes('\n') ? STYLE_WRAP : 0;
        xml += `<c r="${ref}" t="inlineStr"${style ? ` s="${style}"` : ''}><is><t xml:space="preserve">${escapeCellText(text)}</t></is></c>`;
      }
    }
    xml += '</row>';
    if ((r + 1) % ROWS_PER_CHUNK === 0) {
      yield encoder.encode(xml);
      xml = '';
    }
  }
  xml += '</sheetData></worksheet>';
  yield encoder.encode(xml);
}

/** The workbook's bytes. Throws XlsxLimitError if Excel couldn't open the result. */
export async function buildXlsx(input: XlsxInput & { decimal?: DecimalMark }, when = new Date()): Promise<Uint8Array> {
  const rows = readRows(input.text, input.delimiter);
  const dataValues = function* () {
    for (let r = input.headerRow ? 1 : 0; r < rows.length; r++) yield* rows[r];
  };
  const decimal = input.decimal ?? decimalMark(dataValues(), input.delimiter);
  const types = columnTypes(rows, input.headerRow, decimal);
  const decimalCounts = [...new Set(types.filter((t) => t.numeric && t.decimals).map((t) => t.decimals!))].sort((a, b) => a - b);
  const decimalStyle = new Map(decimalCounts.map((d, i) => [d, FIRST_DECIMAL_STYLE + i]));
  const encoder = new TextEncoder();
  const part = (text: string) => [encoder.encode(text)];
  return zip(
    [
      { name: '[Content_Types].xml', chunks: part(CONTENT_TYPES) },
      { name: '_rels/.rels', chunks: part(ROOT_RELS) },
      { name: 'xl/workbook.xml', chunks: part(workbookXml(sheetName(input.fileName))) },
      { name: 'xl/_rels/workbook.xml.rels', chunks: part(WORKBOOK_RELS) },
      { name: 'xl/worksheets/sheet1.xml', chunks: sheetChunks(rows, types, { ...input, decimal }, decimalStyle) },
      { name: 'xl/styles.xml', chunks: part(stylesXml(decimalCounts)) },
    ],
    when,
  );
}

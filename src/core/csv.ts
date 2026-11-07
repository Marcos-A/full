/** A row keeps each field's raw source text and its terminator, so joining them is lossless. */
export interface CsvRow {
  readonly fields: readonly string[];
  readonly eol: string;
}

export interface CsvParseError {
  kind: 'unterminated-quote' | 'text-after-quote';
  line: number;
}

export interface CsvParseResult {
  rows: CsvRow[];
  error: CsvParseError | null;
}

const QUOTE = 34;
const LF = 10;
const CR = 13;

export const DELIMITERS = [',', ';', '\t', '|'] as const;
export type Delimiter = (typeof DELIMITERS)[number];

function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    const c = text.charCodeAt(i);
    if (c === LF || (c === CR && text.charCodeAt(i + 1) !== LF)) line++;
  }
  return line;
}

export function parseCsv(text: string, delimiter: string): CsvParseResult {
  const d = delimiter.charCodeAt(0);
  const n = text.length;
  const rows: CsvRow[] = [];
  let fields: string[] = [];
  let i = 0;
  while (i < n) {
    const start = i;
    if (text.charCodeAt(i) === QUOTE) {
      i++;
      for (;;) {
        const close = text.indexOf('"', i);
        if (close < 0) {
          return { rows: [], error: { kind: 'unterminated-quote', line: lineAt(text, start) } };
        }
        if (text.charCodeAt(close + 1) === QUOTE) {
          i = close + 2;
          continue;
        }
        i = close + 1;
        break;
      }
      if (i < n) {
        const c = text.charCodeAt(i);
        if (c !== d && c !== LF && c !== CR) {
          return { rows: [], error: { kind: 'text-after-quote', line: lineAt(text, i) } };
        }
      }
    } else {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === d || c === LF || c === CR) break;
        i++;
      }
    }
    fields.push(text.slice(start, i));
    if (i >= n) {
      rows.push({ fields, eol: '' });
      fields = [];
      break;
    }
    const c = text.charCodeAt(i);
    if (c === d) {
      i++;
      if (i >= n) {
        fields.push('');
        rows.push({ fields, eol: '' });
        fields = [];
      }
      continue;
    }
    const eolLength = c === CR && text.charCodeAt(i + 1) === LF ? 2 : 1;
    rows.push({ fields, eol: text.slice(i, i + eolLength) });
    fields = [];
    i += eolLength;
  }
  return { rows, error: null };
}

export function serializeCsv(rows: readonly CsvRow[], delimiter: string): string {
  const parts = new Array<string>(rows.length);
  for (let i = 0; i < rows.length; i++) parts[i] = rows[i].fields.join(delimiter) + rows[i].eol;
  return parts.join('');
}

export function fieldValue(raw: string): string {
  if (raw.charCodeAt(0) !== QUOTE) return raw;
  const inner = raw.slice(1, -1);
  return inner.indexOf('"') < 0 ? inner : inner.replace(/""/g, '"');
}

/** Re-encode one edited field. Quotes only if the value needs it or the original was quoted. */
export function encodeField(value: string, originalRaw: string | undefined, delimiter: string): string {
  if (originalRaw !== undefined && fieldValue(originalRaw) === value) return originalRaw;
  const wasQuoted = originalRaw !== undefined && originalRaw.charCodeAt(0) === QUOTE;
  const mustQuote =
    wasQuoted ||
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes('\n') ||
    value.includes('\r');
  return mustQuote ? `"${value.replace(/"/g, '""')}"` : value;
}

const SAMPLE_CHARS = 256 * 1024;
const SAMPLE_ROWS = 200;
/** On a tie, tab and semicolon win over comma: in "1,50;2,75" the comma is a decimal mark. */
const TIE_ORDER: Delimiter[] = ['\t', ';', ',', '|'];

function countPerRow(sample: string, delimiter: string): number[] {
  const d = delimiter.charCodeAt(0);
  const counts: number[] = [];
  let inQuotes = false;
  let count = 0;
  let rowHasContent = false;
  for (let i = 0; i < sample.length && counts.length < SAMPLE_ROWS; i++) {
    const c = sample.charCodeAt(i);
    if (c === QUOTE) {
      inQuotes = !inQuotes;
      rowHasContent = true;
    } else if (!inQuotes && (c === LF || c === CR)) {
      if (rowHasContent) counts.push(count);
      count = 0;
      rowHasContent = false;
      if (c === CR && sample.charCodeAt(i + 1) === LF) i++;
    } else if (!inQuotes && c === d) {
      count++;
      rowHasContent = true;
    } else {
      rowHasContent = true;
    }
  }
  if (rowHasContent && counts.length < SAMPLE_ROWS) counts.push(count);
  return counts;
}

export function detectDelimiter(text: string): Delimiter {
  const sample = text.slice(0, SAMPLE_CHARS);
  let best: Delimiter = ',';
  let bestScore = 0;
  for (const delimiter of TIE_ORDER) {
    const counts = countPerRow(sample, delimiter);
    if (counts.length === 0) continue;
    const frequency = new Map<number, number>();
    for (const count of counts) {
      if (count > 0) frequency.set(count, (frequency.get(count) ?? 0) + 1);
    }
    let modeRows = 0;
    for (const rows of frequency.values()) modeRows = Math.max(modeRows, rows);
    const score = modeRows / counts.length;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

export function columnCountOf(rows: readonly CsvRow[]): number {
  let max = 0;
  for (let i = 0; i < rows.length; i++) if (rows[i].fields.length > max) max = rows[i].fields.length;
  return max;
}

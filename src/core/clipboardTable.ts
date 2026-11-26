export function toTsv(values: string[][]): string {
  return values
    .map((row) =>
      row.map((v) => (/[\t\r\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join('\t'),
    )
    .join('\r\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function toHtmlTable(values: string[][]): string {
  const body = values
    .map(
      (row) =>
        `<tr>${row
          .map((v) => `<td>${escapeHtml(v).replace(/\r\n?|\n/g, '<br>')}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  return `<table>${body}</table>`;
}

/** Parse spreadsheet clipboard text: tabs, line breaks, and Excel-style quoting of awkward cells. */
export function parseTsv(input: string): string[][] {
  const text = input.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const n = text.length;
  while (i <= n) {
    let value = '';
    let parsedQuoted = false;
    if (text[i] === '"') {
      let j = i + 1;
      let inner = '';
      let closed = false;
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            inner += '"';
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        inner += text[j++];
      }
      if (closed && (j >= n || text[j] === '\t' || text[j] === '\n')) {
        value = inner;
        i = j;
        parsedQuoted = true;
      }
    }
    if (!parsedQuoted) {
      let j = i;
      while (j < n && text[j] !== '\t' && text[j] !== '\n') j++;
      value = text.slice(i, j);
      i = j;
    }
    row.push(value);
    if (i >= n) break;
    if (text[i] === '\t') {
      i++;
      if (i >= n) row.push('');
      if (i >= n) break;
      continue;
    }
    rows.push(row);
    row = [];
    i++;
    if (i >= n) return rows;
  }
  if (row.length) rows.push(row);
  return rows;
}

/**
 * What a paste writes into a selection of `height` by `width` cells, as spreadsheets do: when the
 * selection is larger than the pasted block and a whole number of copies of it fits each way, the
 * block repeats to fill it (one value fills every selected cell). Otherwise the block goes in once.
 */
export function fillSelection(values: string[][], height: number, width: number): string[][] {
  const blockHeight = values.length;
  const blockWidth = Math.max(0, ...values.map((row) => row.length));
  if (blockHeight === 0 || blockWidth === 0) return values;
  const larger = height > blockHeight || width > blockWidth;
  if (!larger || height % blockHeight !== 0 || width % blockWidth !== 0) return values;
  return Array.from({ length: height }, (_, r) => {
    const row = values[r % blockHeight];
    return Array.from({ length: width }, (_, c) => row[c % blockWidth] ?? '');
  });
}

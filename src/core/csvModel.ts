import { columnCountOf, CsvRow, encodeField, fieldValue, parseCsv, serializeCsv } from './csv';

interface Splice {
  index: number;
  removed: CsvRow[];
  added: CsvRow[];
}
type Operation = Splice[];

const MAX_UNDO = 200;

/** Editable table. Rows are immutable; every change is a list of splices, so undo restores exact rows. */
export class CsvModel {
  rows: CsvRow[];
  columnCount: number;
  private undoStack: Operation[] = [];
  private redoStack: Operation[] = [];
  private cachedText: string | null = null;

  constructor(rows: CsvRow[], public delimiter: string, public eol: string) {
    this.rows = rows;
    this.columnCount = columnCountOf(rows);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  text(): string {
    if (this.cachedText === null) this.cachedText = serializeCsv(this.rows, this.delimiter);
    return this.cachedText;
  }

  value(row: number, column: number): string | null {
    const raw = this.rows[row]?.fields[column];
    return raw === undefined ? null : fieldValue(raw);
  }

  private applySplice(s: { index: number; removeCount: number; added: CsvRow[] }): void {
    if (s.added.length < 5000 && s.removeCount < 5000) {
      this.rows.splice(s.index, s.removeCount, ...s.added);
    } else {
      this.rows = this.rows
        .slice(0, s.index)
        .concat(s.added, this.rows.slice(s.index + s.removeCount));
    }
  }

  private commit(op: Operation): void {
    if (op.length === 0) return;
    for (const s of op) this.applySplice({ index: s.index, removeCount: s.removed.length, added: s.added });
    this.undoStack.push(op);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.afterChange();
  }

  private afterChange(): void {
    this.columnCount = columnCountOf(this.rows);
    this.cachedText = null;
  }

  undo(): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;
    for (let i = op.length - 1; i >= 0; i--) {
      const s = op[i];
      this.applySplice({ index: s.index, removeCount: s.added.length, added: s.removed });
    }
    this.redoStack.push(op);
    this.afterChange();
    return true;
  }

  redo(): boolean {
    const op = this.redoStack.pop();
    if (!op) return false;
    for (const s of op) this.applySplice({ index: s.index, removeCount: s.removed.length, added: s.added });
    this.undoStack.push(op);
    this.afterChange();
    return true;
  }

  /** Line breaks in typed or pasted values follow the file's dominant style. */
  private normalizeValue(value: string): string {
    return value.replace(/\r\n?|\n/g, this.eol);
  }

  private withValue(row: CsvRow, column: number, value: string): CsvRow {
    const fields = row.fields.slice();
    while (fields.length <= column) fields.push('');
    fields[column] = encodeField(value, row.fields[column], this.delimiter);
    return { fields, eol: row.eol };
  }

  setCell(row: number, column: number, input: string): void {
    this.setRange(row, column, [[input]]);
  }

  /** Fill from (row, column), growing the table as needed, as one undoable action. */
  setRange(startRow: number, startColumn: number, values: string[][]): void {
    const existing = this.rows;
    const lastNeeded = startRow + values.length - 1;
    const added: CsvRow[] = [];
    const removed: CsvRow[] = [];
    let first = -1;
    let changed = false;
    const baseEnd = existing.length;
    const op: Operation = [];

    for (let v = 0; v < values.length; v++) {
      const r = startRow + v;
      const line = values[v];
      const current = r < baseEnd ? existing[r] : null;
      let next: CsvRow = current ?? {
        fields: Array.from({ length: Math.max(1, this.columnCount) }, () => ''),
        eol: '',
      };
      for (let c = 0; c < line.length; c++) {
        const value = this.normalizeValue(line[c]);
        const column = startColumn + c;
        const missing = column >= next.fields.length;
        if (missing && value === '') continue;
        if (!missing && fieldValue(next.fields[column]) === value) continue;
        next = this.withValue(next, column, value);
      }
      if (current && next === current) {
        if (first >= 0) {
          op.push({ index: first, removed: removed.splice(0), added: added.splice(0) });
          first = -1;
        }
        continue;
      }
      changed = true;
      if (first < 0) first = r;
      if (current) removed.push(current);
      added.push(next);
    }
    if (first >= 0) op.push({ index: first, removed, added });
    if (!changed) return;

    // Appended rows: the old last row gains a terminator, and the new last row keeps the
    // file's original "no final newline" state.
    if (lastNeeded >= baseEnd) {
      const lastSplice = op[op.length - 1];
      const hadFinalNewline = baseEnd > 0 && existing[baseEnd - 1].eol !== '';
      const newRows = lastSplice.added.slice(lastSplice.removed.length);
      for (let i = 0; i < newRows.length; i++) {
        const isLast = i === newRows.length - 1;
        newRows[i] = { fields: newRows[i].fields, eol: isLast && !hadFinalNewline && baseEnd > 0 ? '' : this.eol };
      }
      lastSplice.added = lastSplice.added.slice(0, lastSplice.removed.length).concat(newRows);
      if (baseEnd > 0 && !hadFinalNewline) {
        const last = existing[baseEnd - 1];
        const inSplice = baseEnd - 1 - lastSplice.index;
        if (inSplice >= 0) {
          const updated = lastSplice.added[inSplice];
          lastSplice.added[inSplice] = { fields: updated.fields, eol: this.eol };
        } else {
          op.unshift({ index: baseEnd - 1, removed: [last], added: [{ fields: last.fields, eol: this.eol }] });
        }
      }
    }
    this.commit(op);
  }

  clearRange(r0: number, c0: number, r1: number, c1: number): void {
    const values: string[][] = [];
    for (let r = r0; r <= r1; r++) values.push(new Array<string>(c1 - c0 + 1).fill(''));
    this.setRange(r0, c0, values);
  }

  insertRows(at: number, count: number): void {
    const emptyFields = Array.from({ length: Math.max(1, this.columnCount) }, () => '');
    const n = this.rows.length;
    const op: Operation = [];
    if (at >= n) {
      const hadFinalNewline = n === 0 || this.rows[n - 1].eol !== '';
      if (!hadFinalNewline) {
        const last = this.rows[n - 1];
        op.push({ index: n - 1, removed: [last], added: [{ fields: last.fields, eol: this.eol }] });
      }
      const added: CsvRow[] = [];
      for (let i = 0; i < count; i++) {
        added.push({ fields: emptyFields, eol: i === count - 1 && !hadFinalNewline ? '' : this.eol });
      }
      op.push({ index: n, removed: [], added });
    } else {
      const added = Array.from({ length: count }, () => ({ fields: emptyFields, eol: this.eol }));
      op.push({ index: at, removed: [], added });
    }
    this.commit(op);
  }

  deleteRows(r0: number, r1: number): void {
    const n = this.rows.length;
    if (r0 >= n) return;
    const end = Math.min(r1, n - 1);
    const op: Operation = [];
    const removed = this.rows.slice(r0, end + 1);
    op.push({ index: r0, removed, added: [] });
    // Deleting the last row of a file with no final newline must not introduce one.
    if (end === n - 1 && r0 > 0 && this.rows[n - 1].eol === '') {
      const newLast = this.rows[r0 - 1];
      op.push({ index: r0 - 1, removed: [newLast], added: [{ fields: newLast.fields, eol: '' }] });
    }
    this.commit(op);
  }

  private replaceEveryRow(map: (row: CsvRow) => CsvRow): void {
    const added = this.rows.map(map);
    if (this.rows.length > 0) this.commit([{ index: 0, removed: this.rows.slice(), added }]);
  }

  /** Existing fields stay byte-identical; a row too short to reach the column stays short. */
  insertColumns(at: number, count: number): void {
    const blanks = new Array<string>(count).fill('');
    this.replaceEveryRow((row) => {
      if (row.fields.length < at) return row;
      const fields = row.fields.slice();
      fields.splice(at, 0, ...blanks);
      return { fields, eol: row.eol };
    });
  }

  deleteColumns(c0: number, c1: number): void {
    this.replaceEveryRow((row) => {
      if (row.fields.length <= c0) return row;
      const fields = row.fields.slice();
      fields.splice(c0, c1 - c0 + 1);
      return { fields: fields.length ? fields : [''], eol: row.eol };
    });
  }

  /** Whole-table change from outside the grid (raw view, revert). Undoable as one step. */
  replaceAll(rows: CsvRow[]): void {
    const removed = this.rows.slice();
    this.commit([{ index: 0, removed, added: rows }]);
  }

  /** New delimiter means new tokens, so old undo steps no longer apply. */
  reparseWith(delimiter: string): boolean {
    const text = this.text();
    const parsed = parseCsv(text, delimiter);
    if (parsed.error) return false;
    this.delimiter = delimiter;
    this.rows = parsed.rows;
    this.undoStack = [];
    this.redoStack = [];
    this.afterChange();
    return true;
  }
}

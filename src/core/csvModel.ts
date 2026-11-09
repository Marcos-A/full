import { columnCountOf, CsvRow, encodeField, fieldValue, parseCsv, serializeCsv } from './csv';

interface Splice {
  index: number;
  removed: CsvRow[];
  added: CsvRow[];
}
/** How the table looks, not what it holds: undoing one of these leaves the file as it was. */
interface SizeStep {
  widths?: { before: number[]; after: number[] };
  heights?: [row: number, before: number | null, after: number | null][];
}
type Step = Splice | SizeStep;
type Operation = Step[];

/** Sizes to compare against once a resize has finished. */
export interface SizeSnapshot {
  widths: number[];
  heights: [row: number, height: number | null][];
}

const MAX_UNDO = 200;
export const DEFAULT_COLUMN_WIDTH = 120;

/** New position -> old position, after moving [from, to] to before index `target`. */
export function moveOrder(length: number, from: number, to: number, target: number): number[] {
  const indices = Array.from({ length }, (_, i) => i);
  const moved = indices.splice(from, to - from + 1);
  indices.splice(target > to ? target - moved.length : target, 0, ...moved);
  return indices;
}

/** Editable table. Rows are immutable; every change is a list of splices, so undo restores exact rows. */
export class CsvModel {
  rows: CsvRow[];
  columnCount: number;
  private undoStack: Operation[] = [];
  private redoStack: Operation[] = [];
  private cachedText: string | null = null;
  /** Steps of the transaction in progress, which undo as one. */
  private pending: Operation | null = null;
  /** Replaced, never changed in place, so a new array means new widths. Never written to the file. */
  columnWidths: number[] = [];
  /** Rows given their own height, by index. Never written to the file. */
  rowHeights = new Map<number, number>();
  /** Goes up whenever rowHeights changes, including after undo. */
  heightsRevision = 0;
  /** Heights of rows taken out of the table, for when undo brings the same rows back. */
  private retiredHeights: WeakMap<CsvRow, number> | null = null;
  /** Goes up when the table's content changes, and not for a change of size. */
  contentVersion = 0;
  /** What the latest undo step resized, so that repeated nudges can join it. */
  private sizeKey: string | null = null;

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

  /** Takes effect at once and adds nothing to the undo history: see commitSizes. */
  setColumnWidths(widths: number[]): void {
    this.columnWidths = widths;
  }

  captureSizes(rows: Iterable<number> = []): SizeSnapshot {
    return {
      widths: this.columnWidths,
      heights: Array.from(rows, (row) => [row, this.rowHeights.get(row) ?? null]),
    };
  }

  /**
   * One undo step for everything resized since the snapshot, if anything was, so that a drag
   * through many sizes undoes in one go. Consecutive calls with the same key join into one step.
   */
  commitSizes(snapshot: SizeSnapshot, key: string | null = null): void {
    let before = snapshot;
    if (key !== null && key === this.sizeKey) {
      const joined = this.undoStack.pop()![0] as SizeStep;
      before = {
        widths: joined.widths?.before ?? snapshot.widths,
        heights: joined.heights?.map(([row, height]) => [row, height]) ?? snapshot.heights,
      };
    }
    this.sizeKey = null;
    const step: SizeStep = {};
    const after = this.columnWidths;
    if (before.widths.length !== after.length || before.widths.some((width, c) => width !== after[c])) {
      step.widths = { before: before.widths, after };
    }
    const heights = before.heights.flatMap(([row, height]): NonNullable<SizeStep['heights']> => {
      const current = this.rowHeights.get(row) ?? null;
      return current === height ? [] : [[row, height, current]];
    });
    if (heights.length > 0) step.heights = heights;
    if (!step.widths && !step.heights) return;
    this.record([step]);
    this.sizeKey = key;
  }

  private applySizes(step: SizeStep, forward: boolean): void {
    if (step.widths) this.columnWidths = forward ? step.widths.after : step.widths.before;
    if (step.heights) {
      for (const [row, before, after] of step.heights) {
        const height = forward ? after : before;
        if (height === null) this.rowHeights.delete(row);
        else this.rowHeights.set(row, height);
      }
      this.heightsRevision++;
    }
  }

  /** Forward applies the step, and backward takes it out again. Returns whether the content changed. */
  private applyStep(step: Step, forward: boolean): boolean {
    if ('removed' in step) {
      this.applySplice(forward
        ? { index: step.index, removeCount: step.removed.length, added: step.added }
        : { index: step.index, removeCount: step.added.length, added: step.removed });
      return true;
    }
    this.applySizes(step, forward);
    return false;
  }

  /** A null height returns the row to the default. */
  setRowHeights(entries: Iterable<readonly [number, number | null]>): void {
    for (const [row, height] of entries) {
      if (height === null) this.rowHeights.delete(row);
      else this.rowHeights.set(row, height);
    }
    this.heightsRevision++;
  }

  /** Heights follow their rows through moves, insertions and undo; an edited row keeps its place's. */
  private carryHeights(s: { index: number; removeCount: number; added: CsvRow[] }): void {
    if (this.rowHeights.size === 0 && !this.retiredHeights) return;
    const delta = s.added.length - s.removeCount;
    const next = new Map<number, number>();
    const lifted = new Map<CsvRow, { height: number; at: number }>();
    for (const [row, height] of this.rowHeights) {
      if (row < s.index) next.set(row, height);
      else if (row >= s.index + s.removeCount) next.set(row + delta, height);
      else lifted.set(this.rows[row], { height, at: row });
    }
    s.added.forEach((row, i) => {
      const height = lifted.get(row)?.height ?? this.retiredHeights?.get(row);
      if (height === undefined) return;
      next.set(s.index + i, height);
      lifted.delete(row);
    });
    for (const [row, { height, at }] of lifted) {
      if (delta === 0 && !next.has(at)) {
        next.set(at, height);
      } else {
        this.retiredHeights ??= new WeakMap();
        this.retiredHeights.set(row, height);
      }
    }
    this.rowHeights = next;
    this.heightsRevision++;
  }

  private applySplice(s: { index: number; removeCount: number; added: CsvRow[] }): void {
    this.carryHeights(s);
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
    for (const step of op) this.applyStep(step, true);
    this.afterChange();
    if (this.pending) this.pending.push(...op);
    else this.record(op);
  }

  private record(op: Operation): void {
    this.undoStack.push(op);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
    this.redoStack = [];
    this.sizeKey = null;
  }

  /** Every change made inside `run` is one undo step. */
  transaction(run: () => void): void {
    this.pending = [];
    try {
      run();
    } finally {
      const op = this.pending;
      this.pending = null;
      if (op.length > 0) this.record(op);
    }
  }

  private afterChange(): void {
    this.columnCount = columnCountOf(this.rows);
    this.cachedText = null;
    this.contentVersion++;
  }

  undo(): boolean {
    const op = this.undoStack.pop();
    if (!op) return false;
    let content = false;
    for (let i = op.length - 1; i >= 0; i--) content = this.applyStep(op[i], false) || content;
    this.redoStack.push(op);
    this.sizeKey = null;
    if (content) this.afterChange();
    return true;
  }

  redo(): boolean {
    const op = this.redoStack.pop();
    if (!op) return false;
    let content = false;
    for (const step of op) content = this.applyStep(step, true) || content;
    this.undoStack.push(op);
    this.sizeKey = null;
    if (content) this.afterChange();
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
    const op: Splice[] = [];

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
    const op: Splice[] = [];
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
    const op: Splice[] = [];
    const removed = this.rows.slice(r0, end + 1);
    op.push({ index: r0, removed, added: [] });
    // Deleting the last row of a file with no final newline must not introduce one.
    if (end === n - 1 && r0 > 0 && this.rows[n - 1].eol === '') {
      const newLast = this.rows[r0 - 1];
      op.push({ index: r0 - 1, removed: [newLast], added: [{ fields: newLast.fields, eol: '' }] });
    }
    this.commit(op);
  }

  /** `widths` are the columns' widths after the change, which undo takes back with it. */
  private replaceEveryRow(map: (row: CsvRow) => CsvRow, widths: number[]): void {
    const added = this.rows.map(map);
    if (this.rows.length === 0) return;
    const op: Operation = [{ index: 0, removed: this.rows.slice(), added }];
    if (this.columnWidths.length > 0) op.push({ widths: { before: this.columnWidths, after: widths } });
    this.commit(op);
  }

  /** Existing fields stay byte-identical; a row too short to reach the column stays short. */
  insertColumns(at: number, count: number): void {
    const blanks = new Array<string>(count).fill('');
    const widths = this.columnWidths.slice();
    widths.splice(at, 0, ...new Array<number>(count).fill(DEFAULT_COLUMN_WIDTH));
    this.replaceEveryRow((row) => {
      if (row.fields.length < at) return row;
      const fields = row.fields.slice();
      fields.splice(at, 0, ...blanks);
      return { fields, eol: row.eol };
    }, widths);
  }

  deleteColumns(c0: number, c1: number): void {
    const widths = this.columnWidths.slice();
    widths.splice(c0, c1 - c0 + 1);
    this.replaceEveryRow((row) => {
      if (row.fields.length <= c0) return row;
      const fields = row.fields.slice();
      fields.splice(c0, c1 - c0 + 1);
      return { fields: fields.length ? fields : [''], eol: row.eol };
    }, widths);
  }

  /**
   * Move rows so that they sit before index `target` of the current table. Fields travel intact.
   * Line endings stay in position, so the last row keeps the file's final-newline state.
   * Returns the moved rows' new first index, or null if nothing moved.
   */
  moveRows(r0: number, r1: number, target: number): number | null {
    const n = this.rows.length;
    if (target < 0 || target > n || r0 < 0 || r1 >= n || (target >= r0 && target <= r1 + 1)) return null;
    const first = Math.min(r0, target);
    const end = Math.max(r1 + 1, target);
    const section = this.rows.slice(first, end);
    const moved = this.rows.slice(r0, r1 + 1);
    const order = target < r0 ? moved.concat(this.rows.slice(target, r0)) : this.rows.slice(r1 + 1, target).concat(moved);
    const added = order.map((row, i) => (row.eol === section[i].eol ? row : { fields: row.fields, eol: section[i].eol }));
    this.commit([{ index: first, removed: section, added }]);
    return target < r0 ? target : target - moved.length;
  }

  /**
   * Move columns so that they sit before index `target`. Short rows gain only the empty fields
   * needed to keep their values in the right columns, and blank lines stay blank.
   * Returns the moved columns' new first index, or null if nothing moved.
   */
  moveColumns(c0: number, c1: number, target: number): number | null {
    const total = this.columnCount;
    if (target < 0 || target > total || c0 < 0 || c1 >= total || (target >= c0 && target <= c1 + 1)) return null;
    const order = moveOrder(total, c0, c1, target);
    const first = Math.min(c0, target);
    this.replaceEveryRow((row) => {
      if (row.fields.length <= first || (row.fields.length === 1 && row.fields[0] === '')) return row;
      const fields = order.map((from) => row.fields[from] as string | undefined);
      while (fields.length > 0 && fields[fields.length - 1] === undefined) fields.pop();
      return { fields: fields.map((f) => f ?? ''), eol: row.eol };
    }, order.map((from) => this.columnWidths[from] ?? DEFAULT_COLUMN_WIDTH));
    return target < c0 ? target : target - (c1 - c0 + 1);
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
    this.rowHeights = new Map();
    this.heightsRevision++;
    this.columnWidths = [];
    this.undoStack = [];
    this.redoStack = [];
    this.sizeKey = null;
    this.afterChange();
    return true;
  }
}

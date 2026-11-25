import { fieldValue, type CsvRow } from './csv';
import { containsLine, type LineRange } from './gridLines';

/**
 * Find and replace over a table's cell values. Loaded with the table's find bar, never at startup.
 * It works on the model, not on the cells drawn, so a 100,000-row file is searched whole.
 */

export interface FindOptions {
  query: string;
  caseSensitive: boolean;
  /** The whole value has to be the query, not just contain it. */
  wholeCell: boolean;
  /** Only these columns, or every column when null. */
  columns: readonly LineRange[] | null;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The pattern a cell is tested and replaced with, or null when there's nothing to find. */
export function findPattern(options: FindOptions): RegExp | null {
  if (options.query === '') return null;
  const body = escapeRegExp(options.query);
  // `u` so that case is folded by Unicode's rules, as in "À" and "à".
  return new RegExp(options.wholeCell ? `^(?:${body})$` : body, options.caseSensitive ? 'gu' : 'giu');
}

/** Whether a cell's value matches. A plain substring test is the common case, and the fastest. */
export function cellMatcher(options: FindOptions): ((value: string) => boolean) | null {
  const pattern = findPattern(options);
  if (!pattern) return null;
  if (options.caseSensitive && !options.wholeCell) return (value) => value.includes(options.query);
  if (options.caseSensitive) return (value) => value === options.query;
  const test = new RegExp(pattern.source, pattern.flags.replace('g', ''));
  return (value) => test.test(value);
}

/** The value after replacing every occurrence in it, or the whole value for a whole-cell search. */
export function replaceInValue(value: string, options: FindOptions, replacement: string): string {
  const pattern = findPattern(options);
  // A function, so that "$&" and the like in the replacement are taken literally.
  return pattern ? value.replace(pattern, () => replacement) : value;
}

/** Matching cells in reading order: row by row, and left to right in each row. */
export class MatchList {
  readonly rows: number[] = [];
  readonly cols: number[] = [];

  get size(): number {
    return this.rows.length;
  }

  add(row: number, col: number): void {
    this.rows.push(row);
    this.cols.push(col);
  }

  /** The index of the first match at or after this cell, or `size` if there's none. */
  private lowerBound(row: number, col: number): number {
    let lo = 0;
    let hi = this.rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.rows[mid] < row || (this.rows[mid] === row && this.cols[mid] < col)) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  indexOf(row: number, col: number): number {
    const i = this.lowerBound(row, col);
    return i < this.size && this.rows[i] === row && this.cols[i] === col ? i : -1;
  }

  has(row: number, col: number): boolean {
    return this.indexOf(row, col) >= 0;
  }

  /** The next match after this cell, or the previous one before it, going round at the ends. */
  step(row: number, col: number, direction: 1 | -1): number {
    if (this.size === 0) return -1;
    if (direction === 1) {
      const i = this.lowerBound(row, col + 1);
      return i < this.size ? i : 0;
    }
    const i = this.lowerBound(row, col) - 1;
    return i >= 0 ? i : this.size - 1;
  }
}

export interface SearchRun {
  /** Resolves with every match, or null if the search was cancelled first. */
  done: Promise<MatchList | null>;
  cancel(): void;
}

/** About half a frame of work at a time, so that typing and scrolling always come first. */
const SLICE_MS = 6;

const nextTask = (): Promise<void> =>
  new Promise((resolve) => {
    // A message, not setTimeout, which browsers stretch to 4 ms once timeouts nest.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });

/** Tests a run of rows. Separate so that a test can check it without timing. */
export function searchRows(
  rows: readonly CsvRow[],
  from: number,
  to: number,
  matches: (value: string) => boolean,
  columns: readonly LineRange[] | null,
  into: MatchList,
): void {
  for (let r = from; r < to; r++) {
    const fields = rows[r].fields;
    for (let c = 0; c < fields.length; c++) {
      if (columns && !containsLine(columns, c)) continue;
      const raw = fields[c];
      // Most fields aren't quoted, so their value is the field itself.
      if (matches(raw.charCodeAt(0) === 34 ? fieldValue(raw) : raw)) into.add(r, c);
    }
  }
}

/** Searches the rows in slices, giving way between them. `rows` is the array at the start: an edit cancels the run. */
export function searchTable(rows: readonly CsvRow[], options: FindOptions): SearchRun {
  let cancelled = false;
  const matches = cellMatcher(options);
  const done = (async () => {
    const found = new MatchList();
    if (!matches) return found;
    let r = 0;
    while (r < rows.length) {
      const started = performance.now();
      while (r < rows.length && performance.now() - started < SLICE_MS) {
        const end = Math.min(rows.length, r + 500);
        searchRows(rows, r, end, matches, options.columns, found);
        r = end;
      }
      if (r < rows.length) await nextTask();
      if (cancelled) return null;
    }
    return found;
  })();
  return {
    done,
    cancel: () => {
      cancelled = true;
    },
  };
}

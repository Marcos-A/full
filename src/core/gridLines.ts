/** An inclusive run of rows or columns. */
export interface LineRange {
  from: number;
  to: number;
}

/** Sorted, with overlapping and touching ranges joined. */
export function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
  const sorted = ranges.map((r) => ({ from: Math.min(r.from, r.to), to: Math.max(r.from, r.to) })).sort((a, b) => a.from - b.from);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.from <= last.to + 1) last.to = Math.max(last.to, range.to);
    else merged.push(range);
  }
  return merged;
}

export function withoutLine(ranges: readonly LineRange[], line: number): LineRange[] {
  return ranges.flatMap((r) => {
    if (line < r.from || line > r.to) return [r];
    const parts: LineRange[] = [];
    if (line > r.from) parts.push({ from: r.from, to: line - 1 });
    if (line < r.to) parts.push({ from: line + 1, to: r.to });
    return parts;
  });
}

export const containsLine = (ranges: readonly LineRange[], line: number): boolean =>
  ranges.some((r) => line >= r.from && line <= r.to);

export const countLines = (ranges: readonly LineRange[]): number => ranges.reduce((sum, r) => sum + r.to - r.from + 1, 0);

export function expandRanges(ranges: readonly LineRange[]): number[] {
  const lines: number[] = [];
  for (const r of ranges) for (let line = r.from; line <= r.to; line++) lines.push(line);
  return lines;
}

/**
 * Where rows sit when most have the default height. Only rows with their own height are stored,
 * so positions are found by binary search however long the table is.
 */
export class RowLayout {
  private readonly rows: number[];
  /** Pixels added or removed by rows[0..i], inclusive. */
  private readonly extra: number[];

  constructor(heights: ReadonlyMap<number, number>, private readonly first: number, private readonly base: number) {
    const entries = [...heights].filter(([row]) => row >= first).sort((a, b) => a[0] - b[0]);
    let total = 0;
    this.rows = entries.map(([row]) => row);
    this.extra = entries.map(([, height]) => (total += height - base));
  }

  private extraBefore(index: number): number {
    return index > 0 ? this.extra[index - 1] : 0;
  }

  /** Distance from the top of the first row to the top of `row`. */
  top(row: number): number {
    let lo = 0;
    let hi = this.rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.rows[mid] < row) lo = mid + 1;
      else hi = mid;
    }
    return (row - this.first) * this.base + this.extraBefore(lo);
  }

  /** The row under a distance from the top of the first row. Not limited to the end of the table. */
  rowAt(offset: number): number {
    if (offset <= 0) return this.first;
    const topOf = (i: number) => (this.rows[i] - this.first) * this.base + this.extraBefore(i);
    let lo = 0;
    let hi = this.rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (topOf(mid) <= offset) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return this.first + Math.floor(offset / this.base);
    const i = lo - 1;
    const end = topOf(i) + this.base + this.extra[i] - this.extraBefore(i);
    if (offset < end) return this.rows[i];
    return this.rows[i] + 1 + Math.floor((offset - end) / this.base);
  }
}

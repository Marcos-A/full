/** Several separate blocks of cells, as Ctrl/Cmd+click picks them in a spreadsheet. */
import { LineRange, withoutLine } from './gridLines';

/** An inclusive block of cells. */
export interface CellRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export const inRect = (rect: CellRect, row: number, col: number): boolean =>
  row >= rect.top && row <= rect.bottom && col >= rect.left && col <= rect.right;

/** The rows or the columns a block covers. */
export const rectSpan = (rect: CellRect, axis: 'row' | 'column'): LineRange =>
  axis === 'row' ? { from: rect.top, to: rect.bottom } : { from: rect.left, to: rect.right };

const sameRect = (a: CellRect, b: CellRect) => a.top === b.top && a.left === b.left && a.bottom === b.bottom && a.right === b.right;

/** Without repeats, so that clicking the same cell twice doesn't copy or fill it twice. */
export function distinctRects(rects: readonly CellRect[]): CellRect[] {
  const out: CellRect[] = [];
  for (const rect of rects) if (!out.some((r) => sameRect(r, rect))) out.push(rect);
  return out;
}

/**
 * Excel's rule for copying several blocks: when they all cover the same rows they go side by side,
 * left to right, and when they all cover the same columns they're stacked, top to bottom. Any other
 * mix isn't one table, so the answer is null.
 */
export function joinRects(rects: readonly CellRect[], value: (row: number, col: number) => string): string[][] | null {
  const blocks = distinctRects(rects);
  if (blocks.length === 0) return [];
  const [first] = blocks;
  const block = (r: CellRect) => {
    const out: string[][] = [];
    for (let row = r.top; row <= r.bottom; row++) {
      const line: string[] = [];
      for (let col = r.left; col <= r.right; col++) line.push(value(row, col));
      out.push(line);
    }
    return out;
  };
  if (blocks.every((r) => r.top === first.top && r.bottom === first.bottom)) {
    const parts = blocks.slice().sort((a, b) => a.left - b.left).map(block);
    return parts[0].map((_, i) => parts.flatMap((part) => part[i]));
  }
  if (blocks.every((r) => r.left === first.left && r.right === first.right)) {
    return blocks.slice().sort((a, b) => a.top - b.top).flatMap(block);
  }
  return null;
}

/**
 * Takes one row or column out of the blocks that cover all of it, splitting them where needed.
 * Blocks that only cover part of that line stay as they are.
 */
export function withoutWholeLine(
  rects: readonly CellRect[],
  axis: 'row' | 'column',
  line: number,
  isWhole: (rect: CellRect) => boolean,
): CellRect[] {
  return rects.flatMap((rect) => {
    const span = rectSpan(rect, axis);
    if (!isWhole(rect) || line < span.from || line > span.to) return [rect];
    return withoutLine([span], line).map((part) =>
      axis === 'row' ? { ...rect, top: part.from, bottom: part.to } : { ...rect, left: part.from, right: part.to },
    );
  });
}

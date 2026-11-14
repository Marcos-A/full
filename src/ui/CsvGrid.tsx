import { useVirtualizer } from '@tanstack/react-virtual';
import { SetStateAction, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { parseTsv, toHtmlTable, toTsv } from '../core/clipboardTable';
import { CsvModel, DEFAULT_COLUMN_WIDTH as DEFAULT_COLUMN } from '../core/csvModel';
import { containsLine, countLines, expandRanges, LineRange, mergeRanges, RowLayout, withoutLine } from '../core/gridLines';
import { OpenDoc } from '../doc/OpenDoc';
import { S } from '../strings';

const ROW_HEIGHT = 26;
const BAND_HEIGHT = 24;
const MIN_COLUMN = 48;
const MIN_ROW = 20;
const MAX_ROW = 800;
/** Lines in a row taller than the default (see .tall), and the padding and border around them. */
const TALL_LINE = 18;
const TALL_CHROME = 8;
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
/** A cell's padding and border (see .cell), plus a pixel so that rounding never triggers the ellipsis. */
const CELL_CHROME = 14;

interface Selection {
  anchorRow: number;
  anchorCol: number;
  row: number;
  col: number;
}

interface Editing {
  row: number;
  col: number;
  initial: string;
  /** Started by typing: arrow keys commit and move, like a spreadsheet. */
  quick: boolean;
}

function columnName(index: number): string {
  let name = '';
  let n = index;
  do {
    name = String.fromCharCode(65 + (n % 26)) + name;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return name;
}

function measureColumns(csv: CsvModel): number[] {
  const widths = csv.columnWidths.slice(0, csv.columnCount);
  const start = widths.length;
  if (start >= csv.columnCount) return widths;
  for (let c = start; c < csv.columnCount; c++) widths[c] = DEFAULT_COLUMN;
  const longest = new Array<number>(csv.columnCount).fill(0);
  const sample = Math.min(csv.rows.length, 200);
  for (let r = 0; r < sample; r++) {
    const fields = csv.rows[r].fields;
    for (let c = start; c < fields.length; c++) longest[c] = Math.max(longest[c], fields[c].length);
  }
  for (let c = start; c < csv.columnCount; c++) {
    widths[c] = Math.max(72, Math.min(360, longest[c] * 7.8 + 18));
  }
  return widths;
}

type Axis = 'row' | 'column';

interface HeadMenu {
  axis: Axis;
  x: number;
  y: number;
}

interface HeadDrag {
  axis: Axis;
  /** Insert before this row or column. */
  target: number;
}

/** Whole rows or columns picked with Ctrl/Cmd+click, besides the main selection. */
interface ExtraLines {
  axis: Axis;
  ranges: LineRange[];
}

/** A press that moves less than this is a click. */
const DRAG_THRESHOLD = 5;
const AUTOSCROLL_EDGE = 28;

const displayValue = (value: string): string => (/[\r\n]/.test(value) ? value.replace(/\r\n?|\n/g, ' ⏎ ') : value);

const fontOf = (el: Element): string => {
  const style = getComputedStyle(el);
  return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
};

export function CsvGrid({ doc }: { doc: OpenDoc }) {
  const csv = doc.csv!;
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);
  const [composing, setComposing] = useState(false);
  // The active cell from the last session, if this tab was reopened.
  const [selection, setMainSelection] = useState<Selection>(() => {
    const cell = doc.restoredGrid?.cell;
    if (!cell) return { anchorRow: 0, anchorCol: 0, row: 0, col: 0 };
    const row = Math.max(0, Math.min(cell.row, csv.rows.length - 1));
    const col = Math.max(0, Math.min(cell.col, csv.columnCount - 1));
    return { anchorRow: row, anchorCol: col, row, col };
  });
  const [extras, setExtras] = useState<ExtraLines | null>(null);
  /** A new selection replaces any Ctrl/Cmd+clicked lines too. */
  const setSelection = useCallback((update: SetStateAction<Selection>) => {
    setExtras(null);
    setMainSelection(update);
  }, []);
  const [editing, setEditing] = useState<Editing | null>(null);
  const dragging = useRef(false);
  const [menu, setMenu] = useState<HeadMenu | null>(null);
  const [headDrag, setHeadDrag] = useState<HeadDrag | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const rowCount = csv.rows.length;
  const colCount = csv.columnCount;
  const header = doc.headerRow && rowCount > 0;
  const firstBodyRow = header ? 1 : 0;
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const heightsRevision = csv.heightsRevision;
  // The revision is a dependency because the map changes in place.
  const rowHeight = useCallback((row: number) => csv.rowHeights.get(row) ?? ROW_HEIGHT, [csv, heightsRevision]);
  const bandsHeight = BAND_HEIGHT + (header ? rowHeight(0) : 0);
  const rowLayout = useMemo(() => new RowLayout(csv.rowHeights, firstBodyRow, ROW_HEIGHT), [csv, firstBodyRow, heightsRevision]);
  const rowTop = (row: number) => (row < firstBodyRow ? BAND_HEIGHT : bandsHeight + rowLayout.top(row));
  const gutter = Math.max(44, String(rowCount).length * 8 + 20);

  // Right away rather than in an effect, so that a new column is never drawn without a width.
  if (csv.columnWidths.length !== colCount) csv.setColumnWidths(measureColumns(csv));
  const widths = csv.columnWidths;

  const columnWidth = useCallback((c: number) => widths[c] ?? DEFAULT_COLUMN, [widths]);

  const rowVirtual = useVirtualizer({
    count: Math.max(0, rowCount - firstBodyRow),
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => rowHeight(index + firstBodyRow),
    paddingStart: bandsHeight,
    overscan: 12,
  });
  const colVirtual = useVirtualizer({
    horizontal: true,
    count: colCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: columnWidth,
    overscan: 4,
  });
  useLayoutEffect(() => {
    colVirtual.measure();
  }, [widths, colVirtual]);
  useLayoutEffect(() => {
    rowVirtual.measure();
  }, [bandsHeight, firstBodyRow, heightsRevision, rowVirtual]);

  const columnLefts = useMemo(() => {
    const lefts = new Array<number>(colCount + 1);
    let x = gutter;
    for (let c = 0; c < colCount; c++) {
      lefts[c] = x;
      x += columnWidth(c);
    }
    lefts[colCount] = x;
    return lefts;
  }, [colCount, columnWidth, gutter]);
  const totalWidth = columnLefts[colCount] ?? gutter;

  const top = Math.min(selection.anchorRow, selection.row);
  const bottom = Math.max(selection.anchorRow, selection.row);
  const left = Math.min(selection.anchorCol, selection.col);
  const right = Math.max(selection.anchorCol, selection.col);

  /** Null leaves that direction where it is. */
  const scrollToCell = useCallback(
    (row: number | null, col: number | null) => {
      const el = scrollRef.current;
      if (!el) return;
      if (row !== null && row >= firstBodyRow) {
        const y = bandsHeight + rowLayout.top(row);
        const h = rowHeight(row);
        if (y < el.scrollTop + bandsHeight) el.scrollTop = y - bandsHeight;
        else if (y + h > el.scrollTop + el.clientHeight) el.scrollTop = y + h - el.clientHeight;
      }
      if (col === null) return;
      const x = columnLefts[col];
      if (x === undefined) return;
      const w = columnWidth(col);
      if (x < el.scrollLeft + gutter) el.scrollLeft = x - gutter;
      else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
    },
    [bandsHeight, columnLefts, columnWidth, firstBodyRow, gutter, rowHeight, rowLayout],
  );

  const clampRow = useCallback((r: number) => Math.max(0, Math.min(Math.max(0, rowCount - 1), r)), [rowCount]);
  const clampCol = useCallback((c: number) => Math.max(0, Math.min(Math.max(0, colCount - 1), c)), [colCount]);

  const moveTo = useCallback(
    (row: number, col: number, extend = false) => {
      const r = clampRow(row);
      const c = clampCol(col);
      setSelection((s) => (extend ? { ...s, row: r, col: c } : { anchorRow: r, anchorCol: c, row: r, col: c }));
      // Extending whole columns must not jump to the last row, nor whole rows to the last column.
      scrollToCell(extend && r === selection.row ? null : r, extend && c === selection.col ? null : c);
    },
    [clampCol, clampRow, scrollToCell, selection.col, selection.row, setSelection],
  );

  // A structural change can leave the selection outside the table.
  useEffect(() => {
    setSelection((s) => {
      const next = {
        anchorRow: clampRow(s.anchorRow),
        anchorCol: clampCol(s.anchorCol),
        row: clampRow(s.row),
        col: clampCol(s.col),
      };
      return next.anchorRow === s.anchorRow && next.anchorCol === s.anchorCol && next.row === s.row && next.col === s.col
        ? s
        : next;
    });
  }, [clampCol, clampRow, setSelection]);

  /** The whole rows or columns selected, whether by range or with Ctrl/Cmd+click. */
  const selectedLines = useCallback(
    (axis: Axis): LineRange[] => {
      const whole = axis === 'row' ? left === 0 && right === colCount - 1 : top === 0 && bottom === rowCount - 1;
      const ranges = extras?.axis === axis ? extras.ranges.slice() : [];
      if (whole) ranges.push(axis === 'row' ? { from: top, to: bottom } : { from: left, to: right });
      return mergeRanges(ranges);
    },
    [bottom, colCount, extras, left, right, rowCount, top],
  );

  /** What row and column commands act on: the selected lines, or the lines the selection touches. */
  const actingLines = useCallback(
    (axis: Axis): LineRange[] =>
      extras?.axis === axis ? selectedLines(axis) : [axis === 'row' ? { from: top, to: bottom } : { from: left, to: right }],
    [bottom, extras, left, right, selectedLines, top],
  );

  const isHeadSelected = useCallback((axis: Axis, index: number) => containsLine(selectedLines(axis), index), [selectedLines]);

  /** Resizing a selected line resizes all the selected ones; any other line resizes alone. */
  const lineTargets = (axis: Axis, index: number) => (isHeadSelected(axis, index) ? expandRanges(selectedLines(axis)) : [index]);

  const selectionValues = useCallback(
    (r0: number, c0: number, r1: number, c1: number): string[][] => {
      const out: string[][] = [];
      for (let r = r0; r <= r1; r++) {
        const line: string[] = [];
        for (let c = c0; c <= c1; c++) line.push((csv.value(r, c) ?? '').replace(/\r\n?/g, '\n'));
        out.push(line);
      }
      return out;
    },
    [csv],
  );

  /** Separate whole rows or columns are copied side by side, as spreadsheets do. */
  const selectedValues = useCallback((): string[][] => {
    if (!extras) return selectionValues(top, left, bottom, right);
    const lines = expandRanges(selectedLines(extras.axis));
    const across = extras.axis === 'row' ? colCount : rowCount;
    const others = Array.from({ length: across }, (_, i) => i);
    const value = (r: number, c: number) => (csv.value(r, c) ?? '').replace(/\r\n?/g, '\n');
    return extras.axis === 'row'
      ? lines.map((r) => others.map((c) => value(r, c)))
      : others.map((r) => lines.map((c) => value(r, c)));
  }, [bottom, colCount, csv, extras, left, right, rowCount, selectedLines, selectionValues, top]);

  const clearSelected = useCallback(() => {
    if (extras) {
      csv.transaction(() => {
        for (const line of selectedLines(extras.axis)) {
          if (extras.axis === 'row') csv.clearRange(line.from, 0, line.to, colCount - 1);
          else csv.clearRange(0, line.from, rowCount - 1, line.to);
        }
      });
    } else {
      csv.clearRange(top, left, bottom, right);
    }
    doc.gridEdited();
  }, [bottom, colCount, csv, doc, extras, left, right, rowCount, selectedLines, top]);

  const pasteText = useCallback(
    (text: string) => {
      const values = parseTsv(text);
      if (values.length === 0) return;
      const startRow = rowCount === 0 ? 0 : top;
      csv.setRange(startRow, left, values);
      doc.gridEdited();
      const width = Math.max(...values.map((v) => v.length));
      setSelection({
        anchorRow: startRow,
        anchorCol: left,
        row: startRow + values.length - 1,
        col: left + width - 1,
      });
    },
    [csv, doc, left, rowCount, setSelection, top],
  );

  const cut = useCallback(() => {
    void navigator.clipboard?.writeText(toTsv(selectedValues())).catch(() => undefined);
    clearSelected();
  }, [clearSelected, selectedValues]);

  const selectAll = useCallback(() => {
    setSelection({ anchorRow: 0, anchorCol: 0, row: Math.max(0, rowCount - 1), col: Math.max(0, colCount - 1) });
  }, [colCount, rowCount, setSelection]);

  /** As many new lines as are selected, except that selecting every line can't mean doubling the table. */
  const insertionSize = (line: LineRange, total: number) => {
    const size = line.to - line.from + 1;
    return size >= total ? 1 : size;
  };

  // Working from the end of the table keeps the positions of the lines still to do.
  const insertRow = useCallback(
    (where: 'above' | 'below') => {
      const lines = actingLines('row').reverse();
      csv.transaction(() => {
        for (const line of lines) csv.insertRows(where === 'above' ? line.from : line.to + 1, insertionSize(line, rowCount));
      });
      doc.gridEdited();
    },
    [actingLines, csv, doc, rowCount],
  );
  const deleteRows = useCallback(() => {
    const lines = actingLines('row').reverse();
    csv.transaction(() => {
      for (const line of lines) csv.deleteRows(line.from, line.to);
    });
    doc.gridEdited();
  }, [actingLines, csv, doc]);
  const insertColumn = useCallback(
    (where: 'left' | 'right') => {
      const lines = actingLines('column').reverse();
      csv.transaction(() => {
        for (const line of lines) csv.insertColumns(where === 'left' ? line.from : line.to + 1, insertionSize(line, colCount));
      });
      doc.gridEdited();
    },
    [actingLines, colCount, csv, doc],
  );
  const deleteColumns = useCallback(() => {
    const lines = actingLines('column').reverse();
    csv.transaction(() => {
      for (const line of lines) csv.deleteColumns(line.from, line.to);
    });
    doc.gridEdited();
  }, [actingLines, csv, doc]);

  const moveRowsTo = useCallback(
    (r0: number, r1: number, target: number) => {
      const start = csv.moveRows(r0, r1, target);
      if (start === null) return;
      doc.gridEdited();
      const end = start + r1 - r0;
      setSelection({ anchorRow: start, anchorCol: 0, row: end, col: colCount - 1 });
      scrollToCell(target < r0 ? start : end, left);
    },
    [colCount, csv, doc, left, scrollToCell, setSelection],
  );
  const moveColumnsTo = useCallback(
    (c0: number, c1: number, target: number) => {
      const start = csv.moveColumns(c0, c1, target);
      if (start === null) return;
      doc.gridEdited();
      const end = start + c1 - c0;
      setSelection({ anchorRow: 0, anchorCol: start, row: rowCount - 1, col: end });
      scrollToCell(top, target < c0 ? start : end);
    },
    [colCount, csv, doc, rowCount, scrollToCell, setSelection, top],
  );

  // These two take effect at once. Whatever calls them makes the undo step, with commitSizes.
  const resizeColumns = useCallback(
    (cols: number[], width: number) => {
      const size = Math.max(MIN_COLUMN, width);
      const next = csv.columnWidths.slice();
      for (const col of cols) next[col] = size;
      csv.setColumnWidths(next);
      redraw();
    },
    [csv],
  );

  const resizeRows = useCallback(
    (rows: number[], height: number) => {
      const size = Math.max(MIN_ROW, Math.min(MAX_ROW, Math.round(height)));
      csv.setRowHeights(rows.map((row) => [row, size === ROW_HEIGHT ? null : size] as const));
      redraw();
    },
    [csv],
  );

  /** Fits columns to their widest value in every row, but never wider than the visible table. */
  const fitColumns = useCallback(
    (cols: number[]) => {
      const el = scrollRef.current;
      const context = document.createElement('canvas').getContext('2d');
      if (!el || !context) return;
      const limit = el.clientWidth - gutter;
      // Adding up cached characters: measuring whole values takes seconds on a 100,000-row table.
      const measurer = (font: string) => {
        const advances = new Map<string, number>();
        return (text: string) => {
          let width = 0;
          for (const character of text) {
            let advance = advances.get(character);
            if (advance === undefined) {
              context.font = font;
              advance = context.measureText(character).width;
              advances.set(character, advance);
            }
            width += advance;
          }
          return width;
        };
      };
      const measureHeader = measurer(fontOf(el.querySelector('.header-row') ?? el));
      const measureBody = measurer(fontOf(el));
      const fitted = new Map<number, number>();
      for (const col of cols) {
        let widest = 0;
        for (let r = 0; r < rowCount && widest + CELL_CHROME < limit; r++) {
          const value = csv.value(r, col);
          if (!value) continue;
          const measure = r < firstBodyRow ? measureHeader : measureBody;
          const lines = rowHeight(r) > ROW_HEIGHT ? value.split(/\r\n?|\n/) : [displayValue(value)];
          for (const line of lines) widest = Math.max(widest, measure(line));
        }
        fitted.set(col, Math.max(MIN_COLUMN, Math.min(limit, Math.ceil(widest) + CELL_CHROME)));
      }
      const sizes = csv.captureSizes();
      csv.setColumnWidths(csv.columnWidths.map((width, col) => fitted.get(col) ?? width));
      csv.commitSizes(sizes);
      redraw();
    },
    [csv, firstBodyRow, gutter, rowCount, rowHeight],
  );

  /** Fits rows to the most line breaks any of their values has; rows without any return to the default. */
  const fitRows = useCallback(
    (rows: number[]) => {
      const el = scrollRef.current;
      if (!el) return;
      const limit = Math.max(ROW_HEIGHT, el.clientHeight - bandsHeight);
      const sizes = csv.captureSizes(rows);
      csv.setRowHeights(
        rows.map((row) => {
          let lines = 1;
          for (const field of csv.rows[row]?.fields ?? []) {
            if (field.includes('\n') || field.includes('\r')) lines = Math.max(lines, field.split(/\r\n?|\n/).length);
          }
          return [row, lines > 1 ? Math.min(limit, lines * TALL_LINE + TALL_CHROME) : null] as const;
        }),
      );
      csv.commitSizes(sizes);
      redraw();
    },
    [bandsHeight, csv],
  );

  // Its scroll position too, before the first paint, once it's on screen.
  useLayoutEffect(() => {
    const restored = doc.restoredGrid;
    const el = scrollRef.current;
    if (!restored || !el || el.clientHeight === 0) return;
    doc.restoredGrid = null;
    if (restored.gridScroll) {
      el.scrollTop = restored.gridScroll.top;
      el.scrollLeft = restored.gridScroll.left;
    }
  }, [doc]);

  useEffect(() => {
    doc.gridApi = {
      viewState: () => ({
        cell: { row: selection.row, col: selection.col },
        gridScroll: { top: scrollRef.current?.scrollTop ?? 0, left: scrollRef.current?.scrollLeft ?? 0 },
      }),
      focus: () => inputRef.current?.focus({ preventScroll: true }),
      selectionValues: selectedValues,
      allValues: () => selectionValues(0, 0, rowCount - 1, colCount - 1),
      cutSelection: cut,
      pasteText,
      selectAll,
      insertRow,
      deleteRows,
      insertColumn,
      deleteColumns,
      // Separate lines can't move together, in spreadsheets either.
      moveRows: (direction) => {
        if (!extras) moveRowsTo(top, bottom, direction < 0 ? top - 1 : bottom + 2);
      },
      moveColumns: (direction) => {
        if (!extras) moveColumnsTo(left, right, direction < 0 ? left - 1 : right + 2);
      },
      fitRows: () => fitRows(expandRanges(actingLines('row'))),
      fitColumns: () => fitColumns(expandRanges(actingLines('column'))),
    };
    return () => {
      doc.gridApi = null;
    };
  }, [
    actingLines,
    bottom,
    colCount,
    cut,
    deleteColumns,
    deleteRows,
    doc,
    extras,
    fitColumns,
    fitRows,
    insertColumn,
    insertRow,
    left,
    moveColumnsTo,
    moveRowsTo,
    pasteText,
    right,
    rowCount,
    selectAll,
    selectedValues,
    selection.col,
    selection.row,
    selectionValues,
    top,
  ]);

  const beginEdit = useCallback(
    (row: number, col: number, typed?: string) => {
      if (rowCount === 0 || colCount === 0) return;
      setEditing({ row, col, initial: typed ?? csv.value(row, col) ?? '', quick: typed !== undefined });
      scrollToCell(row, col);
    },
    [colCount, csv, rowCount, scrollToCell],
  );

  const commitEdit = useCallback(
    (value: string, move?: { rows: number; cols: number }) => {
      if (!editing) return;
      const { row, col } = editing;
      setEditing(null);
      const before = csv.value(row, col);
      const original = before === null ? '' : before.replace(/\r\n?/g, '\n');
      if (value !== original) {
        csv.setCell(row, col, value);
        doc.gridEdited();
      }
      if (move) {
        moveTo(row + move.rows, col + move.cols);
        // Right now, not on the next frame: the next keystroke may already be on its way.
        inputRef.current?.focus({ preventScroll: true });
      } else {
        requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
      }
    },
    [csv, doc, editing, moveTo],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editing) return;
    if (menu) setMenu(null);
    const { key, shiftKey: shift, altKey: alt } = event;
    const mod = event.metaKey || event.ctrlKey;
    // Accents typed with dead keys (`+a) and IMEs compose in the grid's input, which already has
    // focus. Moving focus now would lose the composition, so wait for it to end.
    if (composingRef.current || event.nativeEvent.isComposing) return;
    if ((key === 'Dead' || key === 'Process') && !mod) return;
    const page = Math.max(1, Math.floor(((scrollRef.current?.clientHeight ?? 400) - bandsHeight) / ROW_HEIGHT) - 1);
    const go = (row: number, col: number) => {
      event.preventDefault();
      moveTo(row, col, shift);
    };
    if (alt && shift && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      const lines = lineTargets('column', selection.col);
      const sizes = csv.captureSizes();
      resizeColumns(lines, columnWidth(selection.col) + (key === 'ArrowLeft' ? -16 : 16));
      csv.commitSizes(sizes, `column:${lines[0]}:${lines.length}`);
      return;
    }
    if (alt && shift && (key === 'ArrowUp' || key === 'ArrowDown')) {
      event.preventDefault();
      const lines = lineTargets('row', selection.row);
      const sizes = csv.captureSizes(lines);
      resizeRows(lines, rowHeight(selection.row) + (key === 'ArrowUp' ? -4 : 4));
      csv.commitSizes(sizes, `row:${lines[0]}:${lines.length}`);
      return;
    }
    // Google Sheets' keys: Excel's Ctrl+- and Ctrl+Shift+= are the browser's zoom.
    if (mod && alt && !event.getModifierState?.('AltGraph')) {
      const inserting = key === '=' || key === '+' || event.code === 'Equal';
      const deleting = key === '-' || event.code === 'Minus';
      const rows = selectedLines('row').length > 0;
      const columns = selectedLines('column').length > 0;
      if ((inserting || deleting) && rows !== columns) {
        event.preventDefault();
        if (rows) {
          if (inserting) insertRow('above');
          else deleteRows();
        } else if (inserting) {
          insertColumn('left');
        } else {
          deleteColumns();
        }
        return;
      }
    }
    switch (key) {
      case 'ArrowUp':
        return go(mod ? 0 : selection.row - 1, selection.col);
      case 'ArrowDown':
        return go(mod ? rowCount - 1 : selection.row + 1, selection.col);
      case 'ArrowLeft':
        return go(selection.row, mod ? 0 : selection.col - 1);
      case 'ArrowRight':
        return go(selection.row, mod ? colCount - 1 : selection.col + 1);
      case 'PageUp':
        return go(selection.row - page, selection.col);
      case 'PageDown':
        return go(selection.row + page, selection.col);
      case 'Home':
        return go(mod ? 0 : selection.row, 0);
      case 'End':
        return go(mod ? rowCount - 1 : selection.row, colCount - 1);
      case 'Tab':
        event.preventDefault();
        return moveTo(selection.row, selection.col + (shift ? -1 : 1));
      case 'Enter':
        event.preventDefault();
        if (shift) return moveTo(selection.row - 1, selection.col);
        return beginEdit(selection.row, selection.col);
      case 'F2':
        event.preventDefault();
        return beginEdit(selection.row, selection.col);
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        clearSelected();
        return;
      case ' ':
        if (shift) {
          event.preventDefault();
          setSelection({ anchorRow: top, anchorCol: 0, row: bottom, col: colCount - 1 });
          return;
        }
        if (mod) {
          event.preventDefault();
          setSelection({ anchorRow: 0, anchorCol: left, row: rowCount - 1, col: right });
          return;
        }
        break;
    }
    if (mod && key.toLowerCase() === 'a') {
      event.preventDefault();
      selectAll();
      return;
    }
    const altGr = event.getModifierState?.('AltGraph');
    if (key.length === 1 && (altGr || (!mod && !alt))) {
      event.preventDefault();
      beginEdit(selection.row, selection.col, key);
    }
  };

  const onCompositionStart = () => {
    composingRef.current = true;
    setComposing(true);
  };
  const onCompositionEnd = (event: React.CompositionEvent<HTMLTextAreaElement>) => {
    composingRef.current = false;
    setComposing(false);
    event.currentTarget.value = '';
    // Synchronous: some browsers follow this with an input event, which must see the edit begun.
    if (event.data) flushSync(() => beginEdit(selection.row, selection.col, event.data));
  };
  /** Text that arrives without a composition, such as from the emoji picker or dictation. */
  const onInput = (event: React.FormEvent<HTMLTextAreaElement>) => {
    if (composingRef.current) return;
    const text = event.currentTarget.value;
    event.currentTarget.value = '';
    if (text && !editing) beginEdit(selection.row, selection.col, text);
  };

  const onCopy = (event: React.ClipboardEvent) => {
    if (editing) return;
    const values = selectedValues();
    event.clipboardData.setData('text/plain', toTsv(values));
    event.clipboardData.setData('text/html', toHtmlTable(values));
    event.preventDefault();
  };
  const onCut = (event: React.ClipboardEvent) => {
    if (editing) return;
    onCopy(event);
    clearSelected();
  };
  const onPaste = (event: React.ClipboardEvent) => {
    if (editing) return;
    event.preventDefault();
    pasteText(event.clipboardData.getData('text/plain'));
  };

  useEffect(() => {
    const stop = () => {
      dragging.current = false;
    };
    window.addEventListener('mouseup', stop);
    return () => window.removeEventListener('mouseup', stop);
  }, []);

  const cellDown = (event: React.MouseEvent, row: number, col: number) => {
    if (event.button !== 0) return;
    if (editing) return;
    dragging.current = true;
    if (event.shiftKey) setSelection((s) => ({ ...s, row, col }));
    else setSelection({ anchorRow: row, anchorCol: col, row, col });
    inputRef.current?.focus({ preventScroll: true });
  };
  const cellEnter = (row: number, col: number) => {
    if (dragging.current) setSelection((s) => ({ ...s, row, col }));
  };
  /** Which boundary a pointer is nearest to: the row or column to insert before. */
  const dropTarget = (axis: Axis, clientX: number, clientY: number): number => {
    const el = scrollRef.current!;
    const box = el.getBoundingClientRect();
    if (axis === 'row') {
      const fromTop = clientY - box.top;
      if (header && fromTop < bandsHeight) return 0;
      const offset = fromTop + el.scrollTop - bandsHeight;
      const under = rowLayout.rowAt(offset);
      const row = offset - rowLayout.top(under) < rowHeight(under) / 2 ? under : under + 1;
      return Math.max(firstBodyRow, Math.min(rowCount, row));
    }
    const x = clientX - box.left + el.scrollLeft;
    let best = 0;
    for (let c = 1; c <= colCount; c++) {
      if (Math.abs(columnLefts[c] - x) < Math.abs(columnLefts[best] - x)) best = c;
    }
    return best;
  };

  /** The row or column under a pointer, to extend a selection to. */
  const lineAt = (axis: Axis, clientX: number, clientY: number): number => {
    const el = scrollRef.current!;
    const box = el.getBoundingClientRect();
    if (axis === 'row') {
      const fromTop = clientY - box.top;
      if (fromTop < bandsHeight && header && el.scrollTop <= 0) return 0;
      // Over the pinned bands, the rows behind them don't count.
      const offset = Math.max(fromTop - bandsHeight, 0) + el.scrollTop;
      return Math.max(firstBodyRow, Math.min(rowCount - 1, rowLayout.rowAt(offset)));
    }
    const x = Math.max(clientX - box.left, gutter) + el.scrollLeft;
    for (let c = colCount - 1; c > 0; c--) {
      if (columnLefts[c] <= x) return c;
    }
    return 0;
  };

  const lineSelection = (axis: Axis, from: number, to: number): Selection =>
    axis === 'row'
      ? { anchorRow: from, anchorCol: 0, row: to, col: colCount - 1 }
      : { anchorRow: 0, anchorCol: from, row: rowCount - 1, col: to };

  const selectHead = (axis: Axis, from: number, to: number) => setSelection(lineSelection(axis, from, to));

  /** A press on one of these moves the selection; separate lines, or all of them, have nowhere to go. */
  const canMoveHead = (axis: Axis, index: number) => {
    if (extras || !isHeadSelected(axis, index)) return false;
    return axis === 'row' ? bottom - top + 1 < rowCount : right - left + 1 < colCount;
  };

  /** Ctrl/Cmd+click: adds a line to the selection, or takes one out. */
  const toggleHead = (axis: Axis, index: number): boolean => {
    const current = selectedLines(axis);
    if (!containsLine(current, index)) {
      setExtras(current.length > 0 ? { axis, ranges: current } : null);
      setMainSelection(lineSelection(axis, index, index));
      return true;
    }
    const remaining = withoutLine(current, index);
    if (remaining.length > 0) {
      const main = remaining[remaining.length - 1];
      setExtras(remaining.length > 1 ? { axis, ranges: remaining.slice(0, -1) } : null);
      setMainSelection(lineSelection(axis, main.from, main.to));
    }
    return false;
  };

  const openHeadMenu = (axis: Axis, target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    setMenu({
      axis,
      x: Math.min(axis === 'row' ? box.right + 2 : box.left, window.innerWidth - 268),
      y: Math.min(axis === 'row' ? box.top : box.bottom + 2, window.innerHeight - 240),
    });
  };

  /**
   * As in Google Sheets, pressing a selected row or column and dragging moves the selection, and
   * dragging from anywhere else selects. A tap has no right button, so it opens the menu.
   */
  const headDown = (event: React.PointerEvent<HTMLElement>, axis: Axis, index: number) => {
    if (event.button !== 0) return;
    // On a Mac this is a right-click, and the context menu event follows.
    if (isMac && event.ctrlKey) return;
    event.preventDefault();
    const head = event.currentTarget;
    const tap = event.pointerType !== 'mouse';
    inputRef.current?.focus({ preventScroll: true });

    const moving = !event.shiftKey && !(isMac ? event.metaKey : event.ctrlKey) && canMoveHead(axis, index);
    const from = axis === 'row' ? top : left;
    const to = axis === 'row' ? bottom : right;
    const extendSelection = (line: number) =>
      setMainSelection((s) => (axis === 'row' ? { ...s, anchorCol: 0, row: line, col: colCount - 1 } : { ...s, anchorRow: 0, row: rowCount - 1, col: line }));

    if (!moving) {
      if (event.shiftKey) {
        if (extras && extras.axis !== axis) setExtras(null);
        extendSelection(index);
      } else if (isMac ? event.metaKey : event.ctrlKey) {
        if (!toggleHead(axis, index)) return;
      } else {
        selectHead(axis, index, index);
      }
    }

    const startX = event.clientX;
    const startY = event.clientY;
    let lastX = startX;
    let lastY = startY;
    let moved = false;
    let target = 0;
    let frame = 0;

    const update = () => {
      if (moving) {
        target = dropTarget(axis, lastX, lastY);
        setHeadDrag({ axis, target });
      } else {
        extendSelection(lineAt(axis, lastX, lastY));
      }
    };
    // Keeps going while the pointer rests near an edge, so long tables can be crossed.
    const autoScroll = () => {
      const el = scrollRef.current;
      if (!el || !moved) return;
      const box = el.getBoundingClientRect();
      const before = axis === 'row' ? el.scrollTop : el.scrollLeft;
      if (axis === 'row') {
        if (lastY > box.bottom - AUTOSCROLL_EDGE) el.scrollTop += ROW_HEIGHT;
        else if (lastY < box.top + bandsHeight + AUTOSCROLL_EDGE) el.scrollTop -= ROW_HEIGHT;
      } else {
        if (lastX > box.right - AUTOSCROLL_EDGE) el.scrollLeft += 24;
        else if (lastX < box.left + gutter + AUTOSCROLL_EDGE) el.scrollLeft -= 24;
      }
      if ((axis === 'row' ? el.scrollTop : el.scrollLeft) !== before) update();
      frame = requestAnimationFrame(autoScroll);
    };
    const finish = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('keydown', onEscape, true);
      cancelAnimationFrame(frame);
      setHeadDrag(null);
    };
    const onMove = (e: PointerEvent) => {
      lastX = e.clientX;
      lastY = e.clientY;
      const distance = axis === 'row' ? Math.abs(lastY - startY) : Math.abs(lastX - startX);
      if (!moved && distance < DRAG_THRESHOLD) return;
      if (!moved) {
        moved = true;
        frame = requestAnimationFrame(autoScroll);
      }
      update();
    };
    const onUp = () => {
      finish();
      if (moved && moving) {
        if (axis === 'row') moveRowsTo(from, to, target);
        else moveColumnsTo(from, to, target);
      } else if (!moved && moving && !tap) {
        // A click inside a selected range picks out that line.
        selectHead(axis, index, index);
      }
      // The head can be gone by now if the table scrolled, so check before measuring it.
      if (!moved && tap && head.isConnected) openHeadMenu(axis, head);
    };
    const onEscape = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      finish();
    };
    // On the window: scrolling can unmount the head being dragged.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('keydown', onEscape, true);
  };

  const headContextMenu = (event: React.MouseEvent<HTMLElement>, axis: Axis, index: number) => {
    event.preventDefault();
    if (!isHeadSelected(axis, index)) selectHead(axis, index, index);
    inputRef.current?.focus({ preventScroll: true });
    openHeadMenu(axis, event.currentTarget);
  };

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const startResize = (event: React.PointerEvent, axis: Axis, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    const startAt = axis === 'row' ? event.clientY : event.clientX;
    const startSize = axis === 'row' ? rowHeight(index) : columnWidth(index);
    const lines = lineTargets(axis, index);
    const sizes = csv.captureSizes(axis === 'row' ? lines : []);
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    let resizing = false;
    const move = (e: PointerEvent) => {
      const change = (axis === 'row' ? e.clientY : e.clientX) - startAt;
      // A hand that trembles during a double-click shouldn't even out the selected lines.
      if (!resizing && Math.abs(change) < 2) return;
      resizing = true;
      if (axis === 'row') resizeRows(lines, startSize + change);
      else resizeColumns(lines, startSize + change);
    };
    const up = () => {
      target.removeEventListener('pointermove', move as EventListener);
      target.removeEventListener('pointerup', up);
      if (resizing) csv.commitSizes(sizes);
    };
    target.addEventListener('pointermove', move as EventListener);
    target.addEventListener('pointerup', up);
  };

  const fitLines = (axis: Axis, lines: number[]) => (axis === 'row' ? fitRows(lines) : fitColumns(lines));

  const columns = colVirtual.getVirtualItems();

  const renderCell = (row: number, col: number) => {
    const fields = csv.rows[row]?.fields;
    const missing = !fields || col >= fields.length;
    const inRange =
      (row >= top && row <= bottom && col >= left && col <= right) ||
      (extras !== null && containsLine(extras.ranges, extras.axis === 'row' ? row : col));
    const isActive = row === selection.row && col === selection.col;
    const height = rowHeight(row);
    const raw = missing ? '' : csv.value(row, col) ?? '';
    const value = height > ROW_HEIGHT ? raw.replace(/\r\n?/g, '\n') : displayValue(raw);
    return (
      <div
        key={col}
        id={`${doc.id}-${row}-${col}`}
        role="gridcell"
        aria-colindex={col + 1}
        aria-selected={inRange}
        aria-label={missing ? S.missingCell : undefined}
        data-row={row}
        data-col={col}
        className={`cell${missing ? ' missing' : ''}${inRange ? ' in-range' : ''}${isActive ? ' active' : ''}`}
        style={{
          left: columnLefts[col],
          width: columnWidth(col),
          lineHeight: height < ROW_HEIGHT ? `${height - 1}px` : undefined,
        }}
        onMouseDown={(event) => cellDown(event, row, col)}
        onMouseEnter={() => cellEnter(row, col)}
        onDoubleClick={() => beginEdit(row, col)}
      >
        {value}
      </div>
    );
  };

  const rowHead = (row: number) => (
    <div
      className={`row-head${
        (row >= top && row <= bottom) || (extras?.axis === 'row' && containsLine(extras.ranges, row)) ? ' in-range' : ''
      }${canMoveHead('row', row) ? ' movable' : ''}`}
      style={{ width: gutter }}
      data-testid="row-head"
      onPointerDown={(event) => headDown(event, 'row', row)}
      onContextMenu={(event) => headContextMenu(event, 'row', row)}
    >
      {row + 1}
      <div
        className="row-resize"
        data-testid="row-resize"
        onPointerDown={(event) => startResize(event, 'row', row)}
        onDoubleClick={() => fitLines('row', lineTargets('row', row))}
      />
    </div>
  );

  const editorTop = editing ? rowTop(editing.row) : 0;

  const closeMenuThen = (action: () => void) => {
    setMenu(null);
    action();
  };

  const menuLines = menu ? expandRanges(actingLines(menu.axis)) : [];
  const menuCount = menu ? countLines(actingLines(menu.axis)) : 0;
  const menuSizes = menu ? new Set(menuLines.map((line) => Math.round(menu.axis === 'row' ? rowHeight(line) : columnWidth(line)))) : null;
  /** Blank when the selected lines differ, as in Excel. */
  const menuSize = menuSizes?.size === 1 ? [...menuSizes][0] : '';

  const dropLine = headDrag && scrollRef.current && (
    <div
      className="drop-line"
      data-testid="drop-line"
      style={
        headDrag.axis === 'row'
          ? {
              left: scrollRef.current.scrollLeft,
              width: scrollRef.current.clientWidth,
              height: 2,
              top:
                headDrag.target < firstBodyRow
                  ? scrollRef.current.scrollTop + BAND_HEIGHT
                  : bandsHeight + rowLayout.top(headDrag.target) - 1,
            }
          : {
              top: scrollRef.current.scrollTop,
              height: scrollRef.current.clientHeight,
              width: 2,
              left: (columnLefts[headDrag.target] ?? gutter) - 1,
            }
      }
    />
  );

  return (
    <>
    <div
      ref={scrollRef}
      className={`grid-scroll${headDrag ? ' moving' : ''}`}
      tabIndex={-1}
      data-testid="grid"
      onFocus={(event) => {
        // Clicks on the scrollbar or empty space focus this element, which can't take text.
        if (event.target === event.currentTarget) inputRef.current?.focus({ preventScroll: true });
      }}
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
      onScroll={() => {
        if (menu) setMenu(null);
      }}
    >
      <div className="grid-inner" style={{ width: totalWidth, height: rowVirtual.getTotalSize() }}>
        <div
          id={`${doc.id}-grid`}
          className="grid-rows"
          role="grid"
          aria-label={S.grid}
          aria-rowcount={rowCount}
          aria-colcount={colCount}
          aria-multiselectable="true"
        >
          <div className="grid-band" role="row" style={{ height: BAND_HEIGHT, width: totalWidth }}>
            <div
              className="corner"
              style={{ width: gutter }}
              role="columnheader"
              aria-label={S.selectAll}
              onMouseDown={(event) => {
                event.preventDefault();
                selectAll();
                inputRef.current?.focus({ preventScroll: true });
              }}
            />
            {columns.map((item) => (
              <div
                key={item.index}
                role="columnheader"
                className={`col-head${
                  (item.index >= left && item.index <= right) || (extras?.axis === 'column' && containsLine(extras.ranges, item.index))
                    ? ' in-range'
                    : ''
                }${canMoveHead('column', item.index) ? ' movable' : ''}`}
                style={{ left: columnLefts[item.index], width: columnWidth(item.index) }}
                data-testid="col-head"
                onPointerDown={(event) => headDown(event, 'column', item.index)}
                onContextMenu={(event) => headContextMenu(event, 'column', item.index)}
              >
                {columnName(item.index)}
                <div
                  className="col-resize"
                  data-testid="col-resize"
                  onPointerDown={(event) => startResize(event, 'column', item.index)}
                  onDoubleClick={() => fitLines('column', lineTargets('column', item.index))}
                />
              </div>
            ))}
          </div>
          {header && (
            <div
              className={`grid-row header-row${rowHeight(0) > ROW_HEIGHT ? ' tall' : ''}`}
              role="row"
              aria-rowindex={1}
              data-testid="header-row"
              style={{ height: rowHeight(0), width: totalWidth, top: BAND_HEIGHT }}
            >
              {rowHead(0)}
              {columns.map((item) => renderCell(0, item.index))}
            </div>
          )}
          {rowVirtual.getVirtualItems().map((item) => {
            const row = item.index + firstBodyRow;
            return (
              <div
                key={item.key}
                className={`grid-row body-row${item.size > ROW_HEIGHT ? ' tall' : ''}`}
                role="row"
                aria-rowindex={row + 1}
                style={{ height: item.size, width: totalWidth, transform: `translateY(${item.start}px)` }}
              >
                {rowHead(row)}
                {columns.map((column) => renderCell(row, column.index))}
              </div>
            );
          })}
        </div>
        {dropLine}
        {/* Holds focus while a cell is selected: a dead key only composes in an editable element,
            and it has to be focused before the key arrives. Hidden until there's text to show. */}
        <textarea
          ref={inputRef}
          className={`grid-input${composing ? ' composing' : ''}`}
          data-testid="grid-input"
          tabIndex={editing ? -1 : 0}
          rows={1}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          inputMode="none"
          aria-label={S.grid}
          aria-controls={`${doc.id}-grid`}
          aria-activedescendant={`${doc.id}-${selection.row}-${selection.col}`}
          style={{
            top: rowTop(selection.row),
            left: columnLefts[selection.col],
            width: composing ? Math.max(columnWidth(selection.col), 160) : undefined,
          }}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={onCompositionEnd}
          onInput={onInput}
        />
        {editing && (
          <CellEditor
            key={`${editing.row}-${editing.col}`}
            editing={editing}
            top={editorTop}
            left={columnLefts[editing.col]}
            width={columnWidth(editing.col)}
            onCommit={commitEdit}
            onCancel={() => {
              setEditing(null);
              inputRef.current?.focus({ preventScroll: true });
            }}
          />
        )}
      </div>
    </div>
    {menu && (
      <div
        ref={menuRef}
        className="menu grid-menu"
        data-testid="head-menu"
        style={{ left: menu.x, top: menu.y }}
        onMouseDown={(event) => {
          if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
        }}
      >
        <div role="menu" className="menu-items">
        {menu.axis === 'row' ? (
          <>
            <button role="menuitem" onClick={() => closeMenuThen(() => insertRow('above'))}>{S.insertRowsAbove(menuCount)}</button>
            <button role="menuitem" onClick={() => closeMenuThen(() => insertRow('below'))}>{S.insertRowsBelow(menuCount)}</button>
            <button role="menuitem" className="separated" onClick={() => closeMenuThen(deleteRows)}>{S.deleteRowCount(menuCount)}</button>
          </>
        ) : (
          <>
            <button role="menuitem" onClick={() => closeMenuThen(() => insertColumn('left'))}>{S.insertColumnsLeft(menuCount)}</button>
            <button role="menuitem" onClick={() => closeMenuThen(() => insertColumn('right'))}>{S.insertColumnsRight(menuCount)}</button>
            <button role="menuitem" className="separated" onClick={() => closeMenuThen(deleteColumns)}>{S.deleteColumnCount(menuCount)}</button>
          </>
        )}
        <button role="menuitem" className="separated" onClick={() => closeMenuThen(() => fitLines(menu.axis, menuLines))}>
          {menu.axis === 'row' ? S.fitRowCount(menuCount) : S.fitColumnCount(menuCount)}
        </button>
        </div>
        {/* Beside the menu role, which can only hold menu items. */}
        <label className="menu-field">
          {menu.axis === 'row' ? S.rowHeight : S.columnWidth}
          <input
            type="number"
            data-testid="head-menu-size"
            min={menu.axis === 'row' ? MIN_ROW : MIN_COLUMN}
            defaultValue={menuSize}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key !== 'Enter' && event.key !== 'Escape') return;
              event.preventDefault();
              const size = Number(event.currentTarget.value);
              if (event.key === 'Enter' && size > 0) {
                const sizes = csv.captureSizes(menu.axis === 'row' ? menuLines : []);
                if (menu.axis === 'row') resizeRows(menuLines, size);
                else resizeColumns(menuLines, size);
                csv.commitSizes(sizes);
              }
              setMenu(null);
              inputRef.current?.focus({ preventScroll: true });
            }}
          />
        </label>
      </div>
    )}
    </>
  );
}

function CellEditor(props: {
  editing: Editing;
  top: number;
  left: number;
  width: number;
  onCommit: (value: string, move?: { rows: number; cols: number }) => void;
  onCancel: () => void;
}) {
  const { editing, onCommit, onCancel } = props;
  const ref = useRef<HTMLTextAreaElement>(null);
  const finished = useRef(false);

  useLayoutEffect(() => {
    const el = ref.current!;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  const commit = (move?: { rows: number; cols: number }) => {
    if (finished.current) return;
    finished.current = true;
    onCommit(ref.current!.value, move);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    const { key, shiftKey: shift } = event;
    if (event.nativeEvent.isComposing) return;
    if (key === 'Enter' && !shift && !event.altKey) {
      event.preventDefault();
      commit({ rows: 1, cols: 0 });
    } else if (key === 'Enter' && event.altKey) {
      event.preventDefault();
      const el = ref.current!;
      el.setRangeText('\n', el.selectionStart, el.selectionEnd, 'end');
    } else if (key === 'Tab') {
      event.preventDefault();
      commit({ rows: 0, cols: shift ? -1 : 1 });
    } else if (key === 'Escape') {
      event.preventDefault();
      finished.current = true;
      onCancel();
    } else if (editing.quick && key.startsWith('Arrow')) {
      event.preventDefault();
      const rows = key === 'ArrowUp' ? -1 : key === 'ArrowDown' ? 1 : 0;
      const cols = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : 0;
      commit({ rows, cols });
    }
  };

  return (
    <textarea
      ref={ref}
      className="grid-editor"
      data-testid="cell-editor"
      defaultValue={editing.initial.replace(/\r\n?/g, '\n')}
      spellCheck={false}
      rows={1}
      style={{ top: props.top, left: props.left, width: Math.max(props.width, 160) }}
      onKeyDown={onKeyDown}
      onBlur={() => commit()}
      onCopy={(event) => event.stopPropagation()}
      onPaste={(event) => event.stopPropagation()}
      onCut={(event) => event.stopPropagation()}
    />
  );
}

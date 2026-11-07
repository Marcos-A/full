import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { parseTsv, toHtmlTable, toTsv } from '../core/clipboardTable';
import { moveOrder } from '../core/csvModel';
import { OpenDoc } from '../doc/OpenDoc';
import { S } from '../strings';

const ROW_HEIGHT = 26;
const BAND_HEIGHT = 24;
const MIN_COLUMN = 48;
const DEFAULT_COLUMN = 120;

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

function measureColumns(doc: OpenDoc): number[] {
  const csv = doc.csv!;
  const widths = doc.columnWidths.slice(0, csv.columnCount);
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

/** A press that moves less than this is a click. */
const DRAG_THRESHOLD = 5;
const AUTOSCROLL_EDGE = 28;

const displayValue = (value: string): string => (/[\r\n]/.test(value) ? value.replace(/\r\n?|\n/g, ' ⏎ ') : value);

export function CsvGrid({ doc }: { doc: OpenDoc }) {
  const csv = doc.csv!;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection>({ anchorRow: 0, anchorCol: 0, row: 0, col: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [widths, setWidths] = useState<number[]>(() => measureColumns(doc));
  const dragging = useRef(false);
  const [menu, setMenu] = useState<HeadMenu | null>(null);
  const [headDrag, setHeadDrag] = useState<HeadDrag | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const rowCount = csv.rows.length;
  const colCount = csv.columnCount;
  const header = doc.headerRow && rowCount > 0;
  const firstBodyRow = header ? 1 : 0;
  const bandsHeight = BAND_HEIGHT + (header ? ROW_HEIGHT : 0);
  const gutter = Math.max(44, String(rowCount).length * 8 + 20);

  useEffect(() => {
    if (widths.length !== colCount) setWidths(measureColumns(doc));
    doc.columnWidths = widths;
  }, [colCount, doc, widths]);

  const columnWidth = useCallback((c: number) => widths[c] ?? DEFAULT_COLUMN, [widths]);

  const rowVirtual = useVirtualizer({
    count: Math.max(0, rowCount - firstBodyRow),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
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
  }, [bandsHeight, rowVirtual]);

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

  const scrollToCell = useCallback(
    (row: number, col: number) => {
      const el = scrollRef.current;
      if (!el) return;
      if (row >= firstBodyRow) {
        const y = bandsHeight + (row - firstBodyRow) * ROW_HEIGHT;
        if (y < el.scrollTop + bandsHeight) el.scrollTop = y - bandsHeight;
        else if (y + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_HEIGHT - el.clientHeight;
      }
      const x = columnLefts[col];
      if (x === undefined) return;
      const w = columnWidth(col);
      if (x < el.scrollLeft + gutter) el.scrollLeft = x - gutter;
      else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth;
    },
    [bandsHeight, columnLefts, columnWidth, firstBodyRow, gutter],
  );

  const clampRow = useCallback((r: number) => Math.max(0, Math.min(Math.max(0, rowCount - 1), r)), [rowCount]);
  const clampCol = useCallback((c: number) => Math.max(0, Math.min(Math.max(0, colCount - 1), c)), [colCount]);

  const moveTo = useCallback(
    (row: number, col: number, extend = false) => {
      const r = clampRow(row);
      const c = clampCol(col);
      setSelection((s) => (extend ? { ...s, row: r, col: c } : { anchorRow: r, anchorCol: c, row: r, col: c }));
      scrollToCell(r, c);
    },
    [clampCol, clampRow, scrollToCell],
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
  }, [clampCol, clampRow]);

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
    [csv, doc, left, rowCount, top],
  );

  const cut = useCallback(() => {
    void navigator.clipboard
      ?.writeText(toTsv(selectionValues(top, left, bottom, right)))
      .catch(() => undefined);
    csv.clearRange(top, left, bottom, right);
    doc.gridEdited();
  }, [bottom, csv, doc, left, right, selectionValues, top]);

  const selectAll = useCallback(() => {
    setSelection({ anchorRow: 0, anchorCol: 0, row: Math.max(0, rowCount - 1), col: Math.max(0, colCount - 1) });
  }, [colCount, rowCount]);

  const insertRow = useCallback(
    (where: 'above' | 'below') => {
      csv.insertRows(where === 'above' ? top : bottom + 1, 1);
      doc.gridEdited();
    },
    [bottom, csv, doc, top],
  );
  const deleteRows = useCallback(() => {
    csv.deleteRows(top, bottom);
    doc.gridEdited();
  }, [bottom, csv, doc, top]);
  const insertColumn = useCallback(
    (where: 'left' | 'right') => {
      const at = where === 'left' ? left : right + 1;
      setWidths((w) => {
        const next = w.slice();
        next.splice(at, 0, DEFAULT_COLUMN);
        return next;
      });
      csv.insertColumns(at, 1);
      doc.gridEdited();
    },
    [csv, doc, left, right],
  );
  const deleteColumns = useCallback(() => {
    setWidths((w) => {
      const next = w.slice();
      next.splice(left, right - left + 1);
      return next;
    });
    csv.deleteColumns(left, right);
    doc.gridEdited();
  }, [csv, doc, left, right]);

  const moveRowsTo = useCallback(
    (r0: number, r1: number, target: number) => {
      const start = csv.moveRows(r0, r1, target);
      if (start === null) return;
      doc.gridEdited();
      const end = start + r1 - r0;
      setSelection({ anchorRow: start, anchorCol: 0, row: end, col: colCount - 1 });
      scrollToCell(target < r0 ? start : end, left);
    },
    [colCount, csv, doc, left, scrollToCell],
  );
  const moveColumnsTo = useCallback(
    (c0: number, c1: number, target: number) => {
      const start = csv.moveColumns(c0, c1, target);
      if (start === null) return;
      setWidths((w) => moveOrder(colCount, c0, c1, target).map((from) => w[from] ?? DEFAULT_COLUMN));
      doc.gridEdited();
      const end = start + c1 - c0;
      setSelection({ anchorRow: 0, anchorCol: start, row: rowCount - 1, col: end });
      scrollToCell(top, target < c0 ? start : end);
    },
    [colCount, csv, doc, rowCount, scrollToCell, top],
  );

  useEffect(() => {
    doc.gridApi = {
      focus: () => scrollRef.current?.focus({ preventScroll: true }),
      selectionValues: () => selectionValues(top, left, bottom, right),
      allValues: () => selectionValues(0, 0, rowCount - 1, colCount - 1),
      cutSelection: cut,
      pasteText,
      selectAll,
      insertRow,
      deleteRows,
      insertColumn,
      deleteColumns,
      moveRows: (direction) => moveRowsTo(top, bottom, direction < 0 ? top - 1 : bottom + 2),
      moveColumns: (direction) => moveColumnsTo(left, right, direction < 0 ? left - 1 : right + 2),
    };
    return () => {
      doc.gridApi = null;
    };
  }, [
    bottom,
    colCount,
    cut,
    deleteColumns,
    deleteRows,
    doc,
    insertColumn,
    insertRow,
    left,
    moveColumnsTo,
    moveRowsTo,
    pasteText,
    right,
    rowCount,
    selectAll,
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
      if (move) moveTo(row + move.rows, col + move.cols);
      requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true }));
    },
    [csv, doc, editing, moveTo],
  );

  const resizeColumn = (col: number, width: number) => {
    setWidths((w) => {
      const next = w.slice();
      next[col] = Math.max(MIN_COLUMN, width);
      return next;
    });
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editing) return;
    if (menu) setMenu(null);
    const { key, shiftKey: shift, altKey: alt } = event;
    const mod = event.metaKey || event.ctrlKey;
    const page = Math.max(1, Math.floor(((scrollRef.current?.clientHeight ?? 400) - bandsHeight) / ROW_HEIGHT) - 1);
    const go = (row: number, col: number) => {
      event.preventDefault();
      moveTo(row, col, shift);
    };
    if (alt && shift && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      event.preventDefault();
      resizeColumn(selection.col, columnWidth(selection.col) + (key === 'ArrowLeft' ? -16 : 16));
      return;
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
        csv.clearRange(top, left, bottom, right);
        doc.gridEdited();
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
    // Accents typed with dead keys (`+a) and IMEs have no character yet. Move focus to the
    // editor during this keydown, so the composition lands there instead of being lost.
    if ((key === 'Dead' || key === 'Process' || event.nativeEvent.isComposing) && !mod) {
      flushSync(() => beginEdit(selection.row, selection.col, ''));
      return;
    }
    const altGr = event.getModifierState?.('AltGraph');
    if (key.length === 1 && (altGr || (!mod && !alt))) {
      event.preventDefault();
      beginEdit(selection.row, selection.col, key);
    }
  };

  const onCopy = (event: React.ClipboardEvent) => {
    if (editing) return;
    const values = selectionValues(top, left, bottom, right);
    event.clipboardData.setData('text/plain', toTsv(values));
    event.clipboardData.setData('text/html', toHtmlTable(values));
    event.preventDefault();
  };
  const onCut = (event: React.ClipboardEvent) => {
    if (editing) return;
    onCopy(event);
    csv.clearRange(top, left, bottom, right);
    doc.gridEdited();
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
    scrollRef.current?.focus({ preventScroll: true });
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
      const row = firstBodyRow + Math.round((fromTop + el.scrollTop - bandsHeight) / ROW_HEIGHT);
      return Math.max(firstBodyRow, Math.min(rowCount, row));
    }
    const x = clientX - box.left + el.scrollLeft;
    let best = 0;
    for (let c = 1; c <= colCount; c++) {
      if (Math.abs(columnLefts[c] - x) < Math.abs(columnLefts[best] - x)) best = c;
    }
    return best;
  };

  const selectHead = (axis: Axis, from: number, to: number) => {
    if (axis === 'row') setSelection({ anchorRow: from, anchorCol: 0, row: to, col: colCount - 1 });
    else setSelection({ anchorRow: 0, anchorCol: from, row: rowCount - 1, col: to });
  };

  const isHeadSelected = (axis: Axis, index: number) =>
    axis === 'row'
      ? left === 0 && right === colCount - 1 && index >= top && index <= bottom
      : top === 0 && bottom === rowCount - 1 && index >= left && index <= right;

  const openHeadMenu = (axis: Axis, target: HTMLElement) => {
    const box = target.getBoundingClientRect();
    setMenu({
      axis,
      x: Math.min(axis === 'row' ? box.right + 2 : box.left, window.innerWidth - 228),
      y: Math.min(axis === 'row' ? box.top : box.bottom + 2, window.innerHeight - 124),
    });
  };

  /** A click selects and offers the menu; pressing and moving drags the selection to a new place. */
  const headDown = (event: React.PointerEvent<HTMLElement>, axis: Axis, index: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const head = event.currentTarget;
    scrollRef.current?.focus({ preventScroll: true });
    if (event.shiftKey) {
      setSelection((s) =>
        axis === 'row' ? { ...s, anchorCol: 0, row: index, col: colCount - 1 } : { ...s, anchorRow: 0, row: rowCount - 1, col: index },
      );
      // On release: the press itself still counts as a click outside any open menu.
      window.addEventListener('pointerup', () => openHeadMenu(axis, head), { once: true });
      return;
    }
    // Pressing inside a selected range moves the whole range.
    const inRange = isHeadSelected(axis, index);
    const from = inRange ? (axis === 'row' ? top : left) : index;
    const to = inRange ? (axis === 'row' ? bottom : right) : index;
    if (!inRange) selectHead(axis, index, index);

    const startX = event.clientX;
    const startY = event.clientY;
    let lastX = startX;
    let lastY = startY;
    let moved = false;
    let target = 0;
    let frame = 0;

    const update = () => {
      target = dropTarget(axis, lastX, lastY);
      setHeadDrag({ axis, target });
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
      if (!moved) {
        // The head can be gone by now if the table scrolled, so check before measuring it.
        if (head.isConnected) openHeadMenu(axis, head);
      } else if (axis === 'row') {
        moveRowsTo(from, to, target);
      } else {
        moveColumnsTo(from, to, target);
      }
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
    scrollRef.current?.focus({ preventScroll: true });
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

  const startResize = (event: React.PointerEvent, col: number) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = columnWidth(col);
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => resizeColumn(col, startWidth + e.clientX - startX);
    const up = () => {
      target.removeEventListener('pointermove', move as EventListener);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move as EventListener);
    target.addEventListener('pointerup', up);
  };

  const columns = colVirtual.getVirtualItems();

  const renderCell = (row: number, col: number) => {
    const fields = csv.rows[row]?.fields;
    const missing = !fields || col >= fields.length;
    const inRange = row >= top && row <= bottom && col >= left && col <= right;
    const isActive = row === selection.row && col === selection.col;
    const value = missing ? '' : displayValue(csv.value(row, col) ?? '');
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
        style={{ left: columnLefts[col], width: columnWidth(col) }}
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
      className={`row-head${row >= top && row <= bottom ? ' in-range' : ''}`}
      style={{ width: gutter }}
      data-testid="row-head"
      onPointerDown={(event) => headDown(event, 'row', row)}
      onContextMenu={(event) => headContextMenu(event, 'row', row)}
    >
      {row + 1}
    </div>
  );

  const editorTop = editing ? (editing.row < firstBodyRow ? BAND_HEIGHT : bandsHeight + (editing.row - firstBodyRow) * ROW_HEIGHT) : 0;

  const closeMenuThen = (action: () => void) => {
    setMenu(null);
    action();
  };

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
                  : bandsHeight + (headDrag.target - firstBodyRow) * ROW_HEIGHT - 1,
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
      role="grid"
      tabIndex={0}
      aria-label={S.grid}
      aria-rowcount={rowCount}
      aria-colcount={colCount}
      aria-multiselectable="true"
      aria-activedescendant={`${doc.id}-${selection.row}-${selection.col}`}
      data-testid="grid"
      onKeyDown={onKeyDown}
      onCopy={onCopy}
      onCut={onCut}
      onPaste={onPaste}
      onScroll={() => {
        if (menu) setMenu(null);
      }}
    >
      <div className="grid-inner" style={{ width: totalWidth, height: rowVirtual.getTotalSize() }}>
        <div className="grid-band" role="row" style={{ height: BAND_HEIGHT, width: totalWidth }}>
          <div
            className="corner"
            style={{ width: gutter }}
            role="columnheader"
            aria-label={S.selectAll}
            onMouseDown={(event) => {
              event.preventDefault();
              selectAll();
              scrollRef.current?.focus({ preventScroll: true });
            }}
          />
          {columns.map((item) => (
            <div
              key={item.index}
              role="columnheader"
              className={`col-head${item.index >= left && item.index <= right ? ' in-range' : ''}`}
              style={{ left: columnLefts[item.index], width: columnWidth(item.index) }}
              data-testid="col-head"
              onPointerDown={(event) => headDown(event, 'column', item.index)}
              onContextMenu={(event) => headContextMenu(event, 'column', item.index)}
            >
              {columnName(item.index)}
              <div
                className="col-resize"
                data-testid="col-resize"
                onPointerDown={(event) => startResize(event, item.index)}
              />
            </div>
          ))}
        </div>
        {header && (
          <div
            className="grid-row header-row"
            role="row"
            aria-rowindex={1}
            data-testid="header-row"
            style={{ height: ROW_HEIGHT, width: totalWidth, top: BAND_HEIGHT }}
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
              className="grid-row body-row"
              role="row"
              aria-rowindex={row + 1}
              style={{ height: ROW_HEIGHT, width: totalWidth, transform: `translateY(${item.start}px)` }}
            >
              {rowHead(row)}
              {columns.map((column) => renderCell(row, column.index))}
            </div>
          );
        })}
        {dropLine}
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
              requestAnimationFrame(() => scrollRef.current?.focus({ preventScroll: true }));
            }}
          />
        )}
      </div>
    </div>
    {menu && (
      <div
        ref={menuRef}
        className="menu grid-menu"
        role="menu"
        data-testid="head-menu"
        style={{ left: menu.x, top: menu.y }}
        onMouseDown={(event) => event.preventDefault()}
      >
        {menu.axis === 'row' ? (
          <>
            <button role="menuitem" onClick={() => closeMenuThen(() => insertRow('above'))}>{S.insertRowAbove}</button>
            <button role="menuitem" onClick={() => closeMenuThen(() => insertRow('below'))}>{S.insertRowBelow}</button>
            <button role="menuitem" className="separated" onClick={() => closeMenuThen(deleteRows)}>{S.deleteRowCount(bottom - top + 1)}</button>
          </>
        ) : (
          <>
            <button role="menuitem" onClick={() => closeMenuThen(() => insertColumn('left'))}>{S.insertColumnLeft}</button>
            <button role="menuitem" onClick={() => closeMenuThen(() => insertColumn('right'))}>{S.insertColumnRight}</button>
            <button role="menuitem" className="separated" onClick={() => closeMenuThen(deleteColumns)}>{S.deleteColumnCount(right - left + 1)}</button>
          </>
        )}
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

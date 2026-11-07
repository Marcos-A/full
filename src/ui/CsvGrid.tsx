import { useVirtualizer } from '@tanstack/react-virtual';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { parseTsv, toHtmlTable, toTsv } from '../core/clipboardTable';
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

const displayValue = (value: string): string => (/[\r\n]/.test(value) ? value.replace(/\r\n?|\n/g, ' ⏎ ') : value);

export function CsvGrid({ doc }: { doc: OpenDoc }) {
  const csv = doc.csv!;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection>({ anchorRow: 0, anchorCol: 0, row: 0, col: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [widths, setWidths] = useState<number[]>(() => measureColumns(doc));
  const dragging = useRef(false);

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

  useEffect(() => {
    doc.gridApi = {
      focus: () => scrollRef.current?.focus({ preventScroll: true }),
      selectionValues: () => selectionValues(top, left, bottom, right),
      allValues: () => selectionValues(0, 0, rowCount - 1, colCount - 1),
      cutSelection: cut,
      pasteText,
      selectAll,
      insertRow: (where) => {
        csv.insertRows(where === 'above' ? top : bottom + 1, 1);
        doc.gridEdited();
      },
      deleteRows: () => {
        csv.deleteRows(top, bottom);
        doc.gridEdited();
      },
      insertColumn: (where) => {
        const at = where === 'left' ? left : right + 1;
        setWidths((w) => {
          const next = w.slice();
          next.splice(at, 0, DEFAULT_COLUMN);
          return next;
        });
        csv.insertColumns(at, 1);
        doc.gridEdited();
      },
      deleteColumns: () => {
        setWidths((w) => {
          const next = w.slice();
          next.splice(left, right - left + 1);
          return next;
        });
        csv.deleteColumns(left, right);
        doc.gridEdited();
      },
    };
    return () => {
      doc.gridApi = null;
    };
  }, [bottom, colCount, csv, cut, doc, left, pasteText, right, rowCount, selectAll, selectionValues, top]);

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
  const rowHeadDown = (event: React.MouseEvent, row: number) => {
    event.preventDefault();
    dragging.current = true;
    if (event.shiftKey) setSelection((s) => ({ ...s, row, col: colCount - 1 }));
    else setSelection({ anchorRow: row, anchorCol: 0, row, col: colCount - 1 });
    scrollRef.current?.focus({ preventScroll: true });
  };
  const colHeadDown = (event: React.MouseEvent, col: number) => {
    event.preventDefault();
    if (event.shiftKey) setSelection((s) => ({ ...s, row: rowCount - 1, col }));
    else setSelection({ anchorRow: 0, anchorCol: col, row: rowCount - 1, col });
    scrollRef.current?.focus({ preventScroll: true });
  };

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
      onMouseDown={(event) => rowHeadDown(event, row)}
      onMouseEnter={() => {
        if (dragging.current) setSelection((s) => ({ ...s, row, col: colCount - 1 }));
      }}
    >
      {row + 1}
    </div>
  );

  const editorTop = editing ? (editing.row < firstBodyRow ? BAND_HEIGHT : bandsHeight + (editing.row - firstBodyRow) * ROW_HEIGHT) : 0;

  return (
    <div
      ref={scrollRef}
      className="grid-scroll"
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
              onMouseDown={(event) => colHeadDown(event, item.index)}
            >
              {columnName(item.index)}
              <div
                className="col-resize"
                data-testid="col-resize"
                onPointerDown={(event) => startResize(event, item.index)}
                onMouseDown={(event) => event.stopPropagation()}
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

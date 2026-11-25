import { useCallback, useEffect, useRef, useState } from 'react';
import { MatchList, replaceInValue, searchTable, type FindOptions, type SearchRun } from '../core/csvSearch';
import { mergeRanges, type LineRange } from '../core/gridLines';
import type { OpenDoc } from '../doc/OpenDoc';
import { ws } from '../doc/workspace';
import { S } from '../strings';
import { columnName } from './CsvGrid';
import './csvFind.css';

interface Cell {
  row: number;
  col: number;
}

const describeColumns = (ranges: readonly LineRange[]) =>
  ranges.map((r) => (r.from === r.to ? columnName(r.from) : `${columnName(r.from)}–${columnName(r.to)}`)).join(', ');

/**
 * Find and replace for the table, above the grid. It searches the model, in slices that give way
 * to typing, so it covers every row however many there are. Loaded with import() when first opened.
 */
export default function CsvFindBar({ doc }: { doc: OpenDoc }) {
  const csv = doc.csv!;
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeCell, setWholeCell] = useState(false);
  const [columns, setColumns] = useState<LineRange[] | null>(null);
  const [matches, setMatches] = useState<MatchList | null>(null);
  const [searching, setSearching] = useState(false);
  const [current, setCurrent] = useState<Cell | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const options: FindOptions = { query, caseSensitive, wholeCell, columns };
  const optionsRef = useRef(options);
  optionsRef.current = options;
  /** What a search depends on, the table's content included. Read when asked, as a replace changes the table between renders. */
  const keyNow = useCallback(() => JSON.stringify([optionsRef.current, csv.contentVersion]), [csv]);
  const currentRef = useRef<Cell | null>(null);
  const run = useRef<{ key: string; search: SearchRun } | null>(null);

  const publish = useCallback(
    (found: MatchList | null, cell: Cell | null) => {
      doc.gridMatches = found && found.size > 0 ? { has: (row, col) => found.has(row, col), current: cell } : null;
      ws.bump();
    },
    [doc],
  );

  /** Starts a search for what's in the fields now, unless one for exactly that is already running or done. */
  const ensureSearch = useCallback((): SearchRun => {
    const wanted = keyNow();
    if (run.current?.key === wanted) return run.current.search;
    run.current?.search.cancel();
    const search = searchTable(csv.rows, optionsRef.current);
    run.current = { key: wanted, search };
    setSearching(true);
    void search.done.then((found) => {
      if (!found || run.current?.search !== search) return;
      setSearching(false);
      setMatches(found);
      publish(found, currentRef.current);
    });
    return search;
  }, [csv, keyNow, publish]);

  /** The matches for the table as it is now, waiting for the search if it's still running. */
  const latestMatches = useCallback(async (): Promise<MatchList | null> => {
    for (;;) {
      const search = ensureSearch();
      const found = await search.done;
      // Otherwise the fields or the table changed while it ran, and the newer search is the one to wait for.
      if (run.current?.search === search) return found;
    }
  }, [ensureSearch]);

  // A new query or option starts again from the active cell.
  useEffect(() => {
    currentRef.current = null;
    setCurrent(null);
    setMessage(null);
  }, [query, caseSensitive, wholeCell, columns]);

  const key = JSON.stringify([options, csv.contentVersion]);
  useEffect(() => {
    ensureSearch();
  }, [key, ensureSearch]);

  useEffect(
    () => () => {
      run.current?.search.cancel();
      doc.gridMatches = null;
    },
    [doc],
  );

  // Each Find or Find and Replace focuses its field, after the palette, if that's where it came
  // from, has put the focus back.
  const request = doc.gridFind?.request;
  const wantsReplace = doc.gridFind?.replace;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const field = (wantsReplace ? replaceRef : findRef).current;
      field?.focus();
      field?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [request, wantsReplace]);

  const select = (found: MatchList, index: number) => {
    const cell = { row: found.rows[index], col: found.cols[index] };
    currentRef.current = cell;
    setCurrent(cell);
    doc.gridApi?.goTo(cell.row, cell.col);
    publish(found, cell);
  };

  /** From the active cell, which may have moved since the last match. The first step takes the active cell itself if it matches. */
  const go = async (direction: 1 | -1) => {
    setMessage(null);
    const found = await latestMatches();
    const api = doc.gridApi;
    if (!found || found.size === 0 || !api) return;
    const at = api.activeCell();
    const here = found.indexOf(at.row, at.col);
    select(found, currentRef.current === null && here >= 0 ? here : found.step(at.row, at.col, direction));
  };

  const replaceOne = async () => {
    setMessage(null);
    const found = await latestMatches();
    const api = doc.gridApi;
    const cell = currentRef.current;
    if (!found || !api) return;
    const at = api.activeCell();
    // Replace only the match on show. Otherwise this first shows the next one, as editors do.
    if (!cell || cell.row !== at.row || cell.col !== at.col || !found.has(cell.row, cell.col)) {
      await go(1);
      return;
    }
    const value = csv.value(cell.row, cell.col) ?? '';
    csv.setCell(cell.row, cell.col, replaceInValue(value, optionsRef.current, replacement));
    doc.gridEdited();
    const after = await latestMatches();
    if (!after || after.size === 0) {
      publish(after, null);
      return;
    }
    select(after, after.step(cell.row, cell.col, 1));
  };

  const replaceAll = async () => {
    const found = await latestMatches();
    if (!found || found.size === 0) return;
    const opts = optionsRef.current;
    const changes = function* () {
      for (let i = 0; i < found.size; i++) {
        const row = found.rows[i];
        const column = found.cols[i];
        yield { row, column, value: replaceInValue(csv.value(row, column) ?? '', opts, replacement) };
      }
    };
    // One change to the model, so one undo puts every cell back.
    const count = csv.setCells(changes());
    if (count > 0) doc.gridEdited();
    currentRef.current = null;
    setCurrent(null);
    setMessage(S.replacedCells(count));
  };

  const close = () => {
    doc.closeGridFind();
    requestAnimationFrame(() => doc.gridApi?.focus());
  };

  const toggleColumns = (on: boolean) => {
    setColumns(on ? mergeRanges(doc.gridApi?.selectedColumns() ?? []) : null);
  };

  const index = matches && current ? matches.indexOf(current.row, current.col) : -1;
  const status =
    query === ''
      ? ''
      : searching
        ? S.searching
        : message ?? (!matches || matches.size === 0 ? S.noMatches : index >= 0 ? S.matchOf(index + 1, matches.size) : S.matchCount(matches.size));

  const phrase = (english: string) => S.editorPhrases[english] ?? english;

  return (
    <div
      className="grid-find"
      role="search"
      aria-label={S.tableFind}
      data-testid="grid-find"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        close();
      }}
    >
      <div className="grid-find-row">
        <input
          ref={findRef}
          className="grid-find-field"
          data-testid="grid-find-query"
          type="text"
          value={query}
          placeholder={phrase('Find')}
          aria-label={phrase('Find')}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void go(event.shiftKey ? -1 : 1);
          }}
        />
        <button className="grid-find-button" onClick={() => void go(1)}>
          {phrase('next')}
        </button>
        <button className="grid-find-button" onClick={() => void go(-1)}>
          {phrase('previous')}
        </button>
        <label>
          <input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} />
          {phrase('match case')}
        </label>
        <label>
          <input type="checkbox" checked={wholeCell} onChange={(event) => setWholeCell(event.target.checked)} />
          {S.wholeCell}
        </label>
        <label>
          <input
            type="checkbox"
            data-testid="grid-find-columns"
            checked={columns !== null}
            onChange={(event) => toggleColumns(event.target.checked)}
          />
          {columns ? S.inColumns(describeColumns(columns)) : S.inSelectedColumns}
        </label>
        <span className="grid-find-status" data-testid="grid-find-status" role="status" aria-live="polite">
          {status}
        </span>
      </div>
      <div className="grid-find-row">
        <input
          ref={replaceRef}
          className="grid-find-field"
          data-testid="grid-find-replacement"
          type="text"
          value={replacement}
          placeholder={phrase('Replace')}
          aria-label={phrase('Replace')}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setReplacement(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
            event.preventDefault();
            void replaceOne();
          }}
        />
        <button className="grid-find-button" onClick={() => void replaceOne()}>
          {phrase('replace')}
        </button>
        <button className="grid-find-button" onClick={() => void replaceAll()}>
          {phrase('replace all')}
        </button>
      </div>
      <button className="grid-find-close" aria-label={phrase('close')} onClick={close}>
        ×
      </button>
    </div>
  );
}

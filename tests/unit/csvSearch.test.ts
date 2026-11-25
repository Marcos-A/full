import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../src/core/csv';
import { CsvModel } from '../../src/core/csvModel';
import { cellMatcher, MatchList, replaceInValue, searchTable, type FindOptions } from '../../src/core/csvSearch';

const model = (text: string, delimiter = ';', eol = '\n') => {
  const { rows, error } = parseCsv(text, delimiter);
  expect(error).toBeNull();
  return new CsvModel(rows, delimiter, eol);
};

const find = (query: string, more: Partial<FindOptions> = {}): FindOptions => ({
  query,
  caseSensitive: false,
  wholeCell: false,
  columns: null,
  ...more,
});

const cells = (list: MatchList) => list.rows.map((row, i) => [row, list.cols[i]]);

describe('matching a cell', () => {
  it('finds a part of the value, ignoring case unless asked', () => {
    expect(cellMatcher(find('bar'))!('Barcelona')).toBe(true);
    expect(cellMatcher(find('bar', { caseSensitive: true }))!('Barcelona')).toBe(false);
    expect(cellMatcher(find('À'))!('València i àlies')).toBe(true);
  });

  it('can ask for the whole cell', () => {
    expect(cellMatcher(find('girona', { wholeCell: true }))!('Girona')).toBe(true);
    expect(cellMatcher(find('girona', { wholeCell: true }))!('Girona nord')).toBe(false);
    expect(cellMatcher(find('Girona', { wholeCell: true, caseSensitive: true }))!('girona')).toBe(false);
  });

  it('takes the query literally, not as a pattern', () => {
    expect(cellMatcher(find('1.5'))!('125')).toBe(false);
    expect(cellMatcher(find('(a+)'))!('x(a+)y')).toBe(true);
  });

  it('finds nothing for an empty query', () => {
    expect(cellMatcher(find(''))).toBeNull();
  });
});

describe('replacing in a cell', () => {
  it('replaces every occurrence, in any case, and keeps $ signs literal', () => {
    expect(replaceInValue('Bar bar BAR', find('bar'), 'x')).toBe('x x x');
    expect(replaceInValue('Bar bar', find('bar', { caseSensitive: true }), '$&$1')).toBe('Bar $&$1');
  });

  it('replaces the whole value for a whole-cell search', () => {
    expect(replaceInValue('Girona', find('girona', { wholeCell: true }), 'Lleida')).toBe('Lleida');
  });
});

describe('the list of matches', () => {
  const list = new MatchList();
  for (const [row, col] of [[0, 1], [2, 0], [2, 3], [5, 2]]) list.add(row, col);

  it('knows each match', () => {
    expect(list.has(2, 3)).toBe(true);
    expect(list.has(2, 2)).toBe(false);
    expect(list.indexOf(5, 2)).toBe(3);
  });

  it('steps forward and back from any cell, and goes round at the ends', () => {
    expect(list.step(2, 0, 1)).toBe(2);
    expect(list.step(2, 1, 1)).toBe(2);
    expect(list.step(5, 2, 1)).toBe(0);
    expect(list.step(2, 3, -1)).toBe(1);
    expect(list.step(0, 0, -1)).toBe(3);
    expect(new MatchList().step(0, 0, 1)).toBe(-1);
  });
});

describe('searching a table', () => {
  it('finds values in reading order, unquoted, the header row included', async () => {
    const csv = model('nom;poble\nAnna;"Bar;celona"\nBarbara;Girona\n');
    const found = (await searchTable(csv.rows, find('bar')).done)!;
    expect(cells(found)).toEqual([
      [1, 1],
      [2, 0],
    ]);
  });

  it('looks only in the columns asked for', async () => {
    const csv = model('a;a;a\na;b;a\n');
    const found = (await searchTable(csv.rows, find('a', { columns: [{ from: 1, to: 2 }] })).done)!;
    expect(cells(found)).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });

  it('covers every row of a large table, giving way as it goes, and can be cancelled', async () => {
    const lines = ['id;nom'];
    for (let i = 0; i < 100_000; i++) lines.push(`${i};Persona ${i}`);
    const csv = model(lines.join('\n') + '\n');
    const found = (await searchTable(csv.rows, find('persona 9999')).done)!;
    expect(cells(found)).toEqual([
      [10_000, 1],
      [99_991, 1],
      [99_992, 1],
      [99_993, 1],
      [99_994, 1],
      [99_995, 1],
      [99_996, 1],
      [99_997, 1],
      [99_998, 1],
      [99_999, 1],
      [100_000, 1],
    ]);
    const run = searchTable(csv.rows, find('persona'));
    run.cancel();
    expect(await run.done).toBeNull();
  });
});

describe('setting many cells at once', () => {
  it('is one undo step, keeps quoting, line endings and untouched rows as they were', () => {
    const text = 'a;b\r\n"x";y\r\nx;"y;z"\r\nq;r';
    const csv = model(text, ';', '\r\n');
    const untouched = csv.rows[3];
    const count = csv.setCells([
      { row: 1, column: 0, value: 'X' },
      { row: 2, column: 1, value: 'y;Z' },
      { row: 2, column: 0, value: 'x' },
      { row: 9, column: 0, value: 'no such row' },
      { row: 0, column: 7, value: 'no such column' },
    ]);
    expect(count).toBe(2);
    expect(csv.text()).toBe('a;b\r\n"X";y\r\nx;"y;Z"\r\nq;r');
    expect(csv.rows[3]).toBe(untouched);
    expect(csv.undo()).toBe(true);
    expect(csv.text()).toBe(text);
    expect(csv.canUndo).toBe(false);
    expect(csv.redo()).toBe(true);
    expect(csv.text()).toBe('a;b\r\n"X";y\r\nx;"y;Z"\r\nq;r');
  });

  it('changes nothing, and records nothing, when every value is already there', () => {
    const csv = model('a;b\n');
    expect(csv.setCells([{ row: 0, column: 0, value: 'a' }])).toBe(0);
    expect(csv.canUndo).toBe(false);
  });

  it('replaces a value in 100,000 rows quickly', () => {
    const lines = [];
    for (let i = 0; i < 100_000; i++) lines.push(`${i};Barcelona`);
    const csv = model(lines.join('\n') + '\n');
    const started = performance.now();
    const count = csv.setCells(lines.map((_, row) => ({ row, column: 1, value: 'Girona' })));
    const ms = performance.now() - started;
    expect(count).toBe(100_000);
    expect(csv.value(99_999, 1)).toBe('Girona');
    expect(ms).toBeLessThan(1000);
    csv.undo();
    expect(csv.value(99_999, 1)).toBe('Barcelona');
  });
});

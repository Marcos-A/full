import { describe, expect, it } from 'vitest';
import { detectDelimiter, encodeField, fieldValue, parseCsv, serializeCsv } from '../../src/core/csv';
import { CsvModel } from '../../src/core/csvModel';
import { parseTsv, toHtmlTable, toTsv } from '../../src/core/clipboardTable';

const model = (text: string, delimiter = ';', eol = '\r\n') => {
  const { rows, error } = parseCsv(text, delimiter);
  expect(error).toBeNull();
  return new CsvModel(rows, delimiter, eol);
};

describe('tokenizer', () => {
  it.each([
    ['plain', 'a,b\n1,2\n'],
    ['no final newline', 'a,b\n1,2'],
    ['CRLF', 'a,b\r\n1,2\r\n'],
    ['mixed endings', 'a,b\r\n1,2\n3,4\r5,6'],
    ['quoted delimiter and newline', '"a,b","c\r\nd"\n"e""f",g\n'],
    ['blank lines', 'a\n\n\nb\n'],
    ['trailing delimiter', 'a,b,\n'],
    ['delimiter at very end', 'a,'],
    ['short and long rows', 'a,b,c\n1\n1,2,3,4\n'],
    ['stray quote inside a field', 'ab"c,d\n'],
    ['empty', ''],
    ['only a newline', '\n'],
  ])('is lossless: %s', (_name, text) => {
    const { rows, error } = parseCsv(text, ',');
    expect(error).toBeNull();
    expect(serializeCsv(rows, ',')).toBe(text);
  });

  it('reads values without converting them', () => {
    const { rows } = parseCsv('007;1,50;=SUM(A1);"say ""hi"""\n', ';');
    expect(rows[0].fields.map(fieldValue)).toEqual(['007', '1,50', '=SUM(A1)', 'say "hi"']);
  });

  it('reports unterminated quotes with a line number', () => {
    expect(parseCsv('a,b\n"open,c\nd\n', ',').error).toEqual({ kind: 'unterminated-quote', line: 2 });
  });

  it('reports text after a closing quote', () => {
    expect(parseCsv('"a"b,c\n', ',').error?.kind).toBe('text-after-quote');
  });
});

describe('delimiter detection', () => {
  it.each([
    ['comma', 'a,b,c\n1,2,3\n', ','],
    ['tab', 'a\tb\n1\t2\n', '\t'],
    ['pipe', 'a|b\n1|2\n', '|'],
    ['Spanish Excel with comma decimals', 'Nom;Preu\nJoan;1,50\nMaria;2,75\nPere;3,00\n', ';'],
    ['semicolons when every value has a decimal comma', '1,50;2,50\n3,50;4,50\n', ';'],
    ['ignores delimiters inside quotes', '"a;b;c",d\n"e;f;g",h\n', ','],
    ['single column', 'one\ntwo\n', ','],
  ])('%s', (_name, text, expected) => {
    expect(detectDelimiter(text)).toBe(expected);
  });
});

describe('editing preserves everything else', () => {
  const fixture = 'nom;"preu";data\r\n"Joan";1,50;007\r\nMaria;"2,75";=SUM(A1)\r\n';

  it('changes only the edited field', () => {
    const m = model(fixture);
    m.setCell(1, 2, '008');
    expect(m.text()).toBe('nom;"preu";data\r\n"Joan";1,50;008\r\nMaria;"2,75";=SUM(A1)\r\n');
  });

  it('keeps a quoted field quoted, and only quotes a plain one if it must', () => {
    expect(encodeField('x', '"old"', ';')).toBe('"x"');
    expect(encodeField('x', 'old', ';')).toBe('x');
    expect(encodeField('a;b', 'old', ';')).toBe('"a;b"');
    expect(encodeField('a"b', 'old', ';')).toBe('"a""b"');
    expect(encodeField('a\nb', 'old', ';')).toBe('"a\nb"');
  });

  it('a no-op edit leaves the raw field alone', () => {
    const m = model('"a";"b"\n');
    m.setCell(0, 0, 'a');
    expect(m.canUndo).toBe(false);
    expect(m.text()).toBe('"a";"b"\n');
  });

  it('does not write missing cells unless they are filled, then pads only as needed', () => {
    const m = model('a;b;c;d\n1\n', ';', '\n');
    m.setCell(1, 3, '');
    expect(m.text()).toBe('a;b;c;d\n1\n');
    m.setCell(1, 2, 'x');
    expect(m.text()).toBe('a;b;c;d\n1;;x\n');
  });

  it('adding a column leaves existing fields byte-identical', () => {
    const m = model('"a";b\n1;"2"\n');
    m.insertColumns(1, 1);
    expect(m.text()).toBe('"a";;b\n1;;"2"\n');
    m.undo();
    expect(m.text()).toBe('"a";b\n1;"2"\n');
  });

  it('deleting a column removes only that column', () => {
    const m = model('a;"b";c\n1;2;3\n');
    m.deleteColumns(1, 1);
    expect(m.text()).toBe('a;c\n1;3\n');
  });

  it('inserting and deleting rows keeps the no-final-newline state', () => {
    const m = model('a;b\n1;2', ';', '\n');
    m.insertRows(2, 1);
    expect(m.text()).toBe('a;b\n1;2\n;');
    m.deleteRows(2, 2);
    expect(m.text()).toBe('a;b\n1;2');
    m.undo();
    m.undo();
    expect(m.text()).toBe('a;b\n1;2');
  });

  it('inserting rows at the end keeps a final newline', () => {
    const m = model('a;b\n', ';', '\n');
    m.insertRows(1, 2);
    expect(m.text()).toBe('a;b\n;\n;\n');
  });

  it('pasting fills from a cell and grows the table as one undo step', () => {
    const before = 'a;b\n1;2';
    const m = model(before, ';', '\n');
    m.setRange(1, 1, [['x', 'y'], ['p', 'q']]);
    expect(m.text()).toBe('a;b\n1;x;y\n;p;q');
    expect(m.rows.length).toBe(3);
    m.undo();
    expect(m.text()).toBe(before);
    m.redo();
    expect(m.text()).toBe('a;b\n1;x;y\n;p;q');
  });

  it('a paste into separated changes keeps unchanged rows untouched', () => {
    const m = model('a;b\n"x";2\nc;d\n', ';', '\n');
    m.setRange(0, 0, [['A'], ['x'], ['C']]);
    expect(m.text()).toBe('A;b\n"x";2\nC;d\n');
    m.undo();
    expect(m.text()).toBe('a;b\n"x";2\nc;d\n');
  });

  it('typed line breaks follow the file style', () => {
    const m = model('a;b\r\n');
    m.setCell(0, 0, 'x\ny');
    expect(m.text()).toBe('"x\r\ny";b\r\n');
  });

  it('survives undo and redo across a 100,000-row table', () => {
    const text = 'a;b\n'.repeat(100_000);
    const m = model(text, ';', '\n');
    m.insertColumns(0, 1);
    expect(m.rows[99_999].fields.length).toBe(3);
    m.undo();
    expect(m.text()).toBe(text);
  });

  describe('moving rows', () => {
    it('moves up and down, keeping raw fields', () => {
      const m = model('"a";b\n"c";d\ne;"f"\n', ';', '\n');
      expect(m.moveRows(2, 2, 0)).toBe(0);
      expect(m.text()).toBe('e;"f"\n"a";b\n"c";d\n');
      m.undo();
      expect(m.moveRows(0, 0, 3)).toBe(2);
      expect(m.text()).toBe('"c";d\ne;"f"\n"a";b\n');
    });
    it('moves a range', () => {
      const m = model('1\n2\n3\n4\n', ';', '\n');
      expect(m.moveRows(1, 2, 4)).toBe(2);
      expect(m.text()).toBe('1\n4\n2\n3\n');
    });
    it('keeps the no-final-newline state whichever row ends up last', () => {
      const before = 'a\r\nb\r\nc';
      const m = model(before);
      m.moveRows(2, 2, 0);
      expect(m.text()).toBe('c\r\na\r\nb');
      m.undo();
      expect(m.text()).toBe(before);
      m.moveRows(0, 0, 3);
      expect(m.text()).toBe('b\r\nc\r\na');
    });
    it('is a no-op when dropped where it already is, or out of range', () => {
      const m = model('1\n2\n3\n', ';', '\n');
      for (const target of [1, 2, -1, 4]) expect(m.moveRows(1, 1, target)).toBeNull();
      expect(m.canUndo).toBe(false);
    });
  });

  describe('moving columns', () => {
    it('moves left and right, keeping raw fields', () => {
      const m = model('"a";b;c\n1;"2";3\n', ';', '\n');
      expect(m.moveColumns(2, 2, 0)).toBe(0);
      expect(m.text()).toBe('c;"a";b\n3;1;"2"\n');
      m.undo();
      expect(m.moveColumns(0, 0, 3)).toBe(2);
      expect(m.text()).toBe('b;c;"a"\n"2";3;1\n');
      m.undo();
      expect(m.text()).toBe('"a";b;c\n1;"2";3\n');
    });
    it('moves a range', () => {
      const m = model('a;b;c;d\n', ';', '\n');
      expect(m.moveColumns(0, 1, 3)).toBe(1);
      expect(m.text()).toBe('c;a;b;d\n');
    });
    it('leaves rows too short to be affected, and pads others only as far as needed', () => {
      const m = model('a;b;c;d\n1\n1;2;3\n\n', ';', '\n');
      m.moveColumns(2, 2, 4);
      expect(m.text()).toBe('a;b;d;c\n1\n1;2;;3\n\n');
    });
    it('is a no-op when dropped where it already is', () => {
      const m = model('a;b;c\n', ';', '\n');
      for (const target of [1, 2, -1, 4]) expect(m.moveColumns(1, 1, target)).toBeNull();
    });
  });

  it('reparsing with another delimiter is lossless', () => {
    const m = model('a,b;c\n');
    expect(m.reparseWith(',')).toBe(true);
    expect(m.columnCount).toBe(2);
    expect(m.text()).toBe('a,b;c\n');
  });
});

describe('clipboard tables', () => {
  it('writes tab-separated text with quoting', () => {
    expect(toTsv([['a', 'b\tc'], ['d"e', 'f\ng']])).toBe('a\t"b\tc"\r\n"d""e"\t"f\ng"');
  });
  it('escapes HTML: cell values are never markup', () => {
    expect(toHtmlTable([['<img onerror=x>', 'a&b']])).toBe('<table><tr><td>&lt;img onerror=x&gt;</td><td>a&amp;b</td></tr></table>');
  });
  it.each([
    ['a\tb\r\nc\td\r\n', [['a', 'b'], ['c', 'd']]],
    ['a\tb\nc\td', [['a', 'b'], ['c', 'd']]],
    ['"x\ny"\t"q""r"\n', [['x\ny', 'q"r']]],
    ['a\t\tb', [['a', '', 'b']]],
    ['a\t', [['a', '']]],
    ['one', [['one']]],
    ['5" disk\tb', [['5" disk', 'b']]],
    ['"open\tb', [['"open', 'b']]],
  ])('parses %j', (input, expected) => {
    expect(parseTsv(input)).toEqual(expected);
  });
  it('round trips', () => {
    const values = [['a', 'b\tc'], ['d"e', 'f\ng']];
    expect(parseTsv(toTsv(values))).toEqual(values);
  });
});

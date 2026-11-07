import { describe, expect, it } from 'vitest';
import { detectLineEndings, fromEditorText, toEditorText } from '../../src/core/lineEndings';
import { joinRenderedMarkdown, minimalChange, splitBlocks, splitFrontMatter } from '../../src/core/markdownParts';
import { classifyImage, classifyLink } from '../../src/core/urls';
import { kindFromName } from '../../src/core/fileTypes';
import { fuzzyScore } from '../../src/core/fuzzy';
import { selectEvictions } from '../../src/recovery/store';
import { pickLanguage, S, setLanguage } from '../../src/strings';
import { ca } from '../../src/strings.ca';

describe('language', () => {
  it.each([
    [null, ['ca-ES'], 'ca'],
    [null, ['ca-ES-valencia'], 'ca'],
    [null, ['CA'], 'ca'],
    [null, ['en-GB', 'ca'], 'en'],
    [null, ['es-ES', 'ca'], 'ca'],
    [null, ['es-ES', 'fr'], 'en'],
    [null, [], 'en'],
    ['en', ['ca-ES'], 'en'],
    ['ca', ['en-US'], 'ca'],
    ['xx', ['ca-ES'], 'ca'],
  ])('stored %j, browser %j gives %j', (stored, preferred, expected) => {
    expect(pickLanguage(stored, preferred)).toBe(expected);
  });

  it('formats Catalan counts with a dot and real singulars', () => {
    expect(ca.rowsColumns(1000, 1)).toBe('1.000 files × 1 columna');
    expect(ca.rowsColumns(1, 2)).toBe('1 fila × 2 columnes');
  });

  it.each([
    [1, 1, '1 row × 1 column'],
    [1, 3, '1 row × 3 columns'],
    [3, 1, '3 rows × 1 column'],
    [0, 0, '0 rows × 0 columns'],
    [1000, 2, '1,000 rows × 2 columns'],
  ])('English counts for %i × %i', (rows, columns, expected) => {
    setLanguage('en');
    expect(S.rowsColumns(rows, columns)).toBe(expected);
  });
});

describe('line endings', () => {
  it.each([
    ['a\nb\n', 'lf', 'lf'],
    ['a\r\nb\r\n', 'crlf', 'crlf'],
    ['a\rb\r', 'cr', 'cr'],
    ['no break', 'lf', 'lf'],
    ['a\r\nb\r\nc\n', 'mixed', 'crlf'],
    ['a\nb\nc\r\n', 'mixed', 'lf'],
  ])('%j', (text, ending, dominant) => {
    expect(detectLineEndings(text)).toEqual({ ending, dominant });
  });
  it('round trips pure files, including no final newline', () => {
    for (const [text, kind] of [['a\r\nb', 'crlf'], ['a\rb\r', 'cr'], ['a\nb', 'lf']] as const) {
      expect(fromEditorText(toEditorText(text), kind)).toBe(text);
    }
  });
});

describe('Markdown parts', () => {
  it('splits front matter exactly', () => {
    expect(splitFrontMatter('---\ntitle: x\n---\n# Hi\n')).toEqual({ frontMatter: '---\ntitle: x\n---\n', body: '# Hi\n' });
    expect(splitFrontMatter('# Hi\n---\n')).toEqual({ frontMatter: '', body: '# Hi\n---\n' });
    expect(splitFrontMatter('---\n---\nx').frontMatter).toBe('---\n---\n');
  });
  it('a rendered edit keeps front matter and final newline state', () => {
    expect(joinRenderedMarkdown('---\na: 1\n---\nold\n', 'new\n')).toBe('---\na: 1\n---\nnew\n');
    expect(joinRenderedMarkdown('old', 'new\n')).toBe('new');
  });
  it('computes minimal changes', () => {
    expect(minimalChange('hello world', 'hello there world')).toEqual({ from: 6, to: 6, insert: 'there ' });
    expect(minimalChange('same', 'same')).toBeNull();
    expect(minimalChange('aaa', 'aa')).toEqual({ from: 2, to: 3, insert: '' });
  });
});

describe('URL safety', () => {
  it.each([
    ['https://a.example/x', 'external'],
    ['mailto:a@b.c', 'external'],
    ['#section', 'anchor'],
    ['docs/a.md', 'relative'],
    ['javascript:alert(1)', 'blocked'],
    ['JaVaScRiPt:alert(1)', 'blocked'],
    ['java\nscript:alert(1)', 'blocked'],
    ['  javascript:alert(1)', 'blocked'],
    ['data:text/html,<script>1</script>', 'blocked'],
    ['vbscript:x', 'blocked'],
  ])('link %j', (href, expected) => {
    expect(classifyLink(href)).toBe(expected);
  });
  it.each([
    ['https://a.example/i.png', 'remote'],
    ['http://a.example/i.png', 'blocked'],
    ['./i.png', 'relative'],
    ['i.png', 'relative'],
    ['data:image/png;base64,AAAA', 'data'],
    ['data:image/svg+xml,<svg onload=x>', 'blocked'],
    ['javascript:x', 'blocked'],
  ])('image %j', (src, expected) => {
    expect(classifyImage(src)).toBe(expected);
  });
});

describe('file types', () => {
  it.each([
    ['a.csv', 'csv'], ['A.CSV', 'csv'], ['a.md', 'markdown'], ['a.MarkDown', 'markdown'],
    ['a.txt', 'text'], ['A.TXT', 'text'], ['a.xlsx', null], ['txt', null],
  ])('%s', (name, kind) => {
    expect(kindFromName(name)).toBe(kind);
  });
});

it('fuzzy matching is an ordered subsequence and prefers word starts', () => {
  expect(fuzzyScore('sva', 'Save As')).not.toBeNull();
  expect(fuzzyScore('xyz', 'Save As')).toBeNull();
  expect(fuzzyScore('save', 'Save As')!).toBeGreaterThan(fuzzyScore('save', 'Copy as vector save')!);
});

describe('eviction rule', () => {
  const rec = (id: string, hasUnsavedChanges: boolean, updatedAt: number) => ({ id, hasUnsavedChanges, updatedAt });
  it('keeps everything up to the limit', () => {
    expect(selectEvictions([rec('a', false, 1)], 10)).toEqual([]);
  });
  it('evicts clean files oldest first, before any unsaved file', () => {
    const records = [rec('u1', true, 1), rec('c2', false, 5), rec('c1', false, 3), rec('u2', true, 2)];
    expect(selectEvictions(records, 2).map((r) => r.id)).toEqual(['c1', 'c2']);
  });
  it('evicts the oldest unsaved once no clean files remain', () => {
    const records = [rec('u2', true, 2), rec('u1', true, 1), rec('u3', true, 3)];
    expect(selectEvictions(records, 2).map((r) => r.id)).toEqual(['u1']);
  });
});

describe('splitting big Markdown into sections', () => {
  const pad = 'x'.repeat(110 * 1024);
  it('leaves small documents whole', () => {
    expect(splitBlocks('# a\n\n# b\n')).toEqual(['# a\n\n# b\n']);
  });
  it('splits at top-level headings, losslessly', () => {
    const text = `intro ${pad}\n\n# a\nb\n\n## c\n\n#not a heading\n   # indented stays\n`;
    const blocks = splitBlocks(text);
    expect(blocks.join('')).toBe(text);
    expect(blocks.map((b) => b.slice(0, 3))).toEqual(['int', '# a', '## ']);
  });
  it('does not split inside code fences, and only the matching fence closes them', () => {
    const text = `${pad}\n\`\`\`\n# no\n~~~\n# no\n\`\`\`\n# yes\n~~~~\n# no\n~~~\n# no\n~~~~\n# yes\n`;
    expect(splitBlocks(text).map((b) => b.split('\n')[0])).toEqual([pad, '# yes', '# yes']);
  });
  it.each([
    ['reference definitions', '[ref]: https://a.example\n'],
    ['indented definitions', '  [ref]: x\n'],
    ['footnotes', '[^1]: note\n'],
    ['HTML comments', '<!-- a\n'],
    ['pre blocks', '<pre>\n'],
    ['script blocks', '<SCRIPT src=x>\n'],
  ])('keeps the document whole when it has %s', (_name, extra) => {
    const text = `${pad}\n# a\n${extra}# b\n`;
    expect(splitBlocks(text)).toEqual([text]);
  });
});

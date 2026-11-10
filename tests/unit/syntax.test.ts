import { describe, expect, it } from 'vitest';
import { canColour, loadedGrammar, loadGrammar } from '../../src/doc/syntax';

describe('grammars by file name', () => {
  it.each([
    ['a.py', 'python'], ['A.PY', 'python'], ['a.c', 'cpp'], ['a.h', 'cpp'], ['a.hpp', 'cpp'], ['a.java', 'java'],
    ['a.rs', 'rust'], ['a.go', 'go'], ['a.php', 'php'], ['a.json', 'json'], ['a.yml', 'yaml'], ['a.svg', 'xml'],
    ['a.sh', 'shell'], ['types.d.ts', 'typescript'],
  ])('%s is %s', async (name, language) => {
    expect((await loadGrammar(name))?.name).toBe(language);
    expect(loadedGrammar(name)?.name).toBe(language);
  });

  it('has the bundled ones with no waiting', () => {
    for (const name of ['a.js', 'a.html', 'a.css', 'a.ts', 'a.jsx', 'a.tsx']) expect(loadedGrammar(name)).not.toBeNull();
  });

  it.each(['a.txt', 'a.md', 'a.csv', 'notes', 'notes.', '.py', 'a.constructor', 'a.__proto__'])('%s has none', async (name) => {
    expect(loadedGrammar(name)).toBeNull();
    expect(await loadGrammar(name)).toBeNull();
  });
});

describe('what is small enough to colour', () => {
  it('stops at the size limit', () => {
    expect(canColour('a\n'.repeat(512 * 1024))).toBe(true);
    expect(canColour('a\n'.repeat(512 * 1024) + 'a')).toBe(false);
  });

  it('stops at the line limit, wherever the long line is', () => {
    expect(canColour('x'.repeat(10_000))).toBe(true);
    expect(canColour('x'.repeat(10_001))).toBe(false);
    expect(canColour(`a\n${'x'.repeat(10_001)}\nb`)).toBe(false);
    expect(canColour('')).toBe(true);
  });
});

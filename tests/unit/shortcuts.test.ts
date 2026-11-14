import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filterSections, formatKeys, readmeRows, SHORTCUTS, shortcutSections } from '../../src/ui/shortcuts';

/** The rows of the table under a README heading, without its header and separator. */
function tableRows(path: string, heading: string): string[] {
  const lines = readFileSync(path, 'utf8').split('\n');
  const start = lines.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const rows: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('|')) rows.push(line);
    else if (rows.length > 0) break;
  }
  return rows.slice(2);
}

describe('the shortcut list', () => {
  it("is the English README's Keyboard table, row for row", () => {
    expect(tableRows('README.md', '## Keyboard')).toEqual(readmeRows('en'));
  });

  it("is the Catalan README's Teclat table, row for row", () => {
    expect(tableRows('README.ca.md', '## Teclat')).toEqual(readmeRows('ca'));
  });

  it('names only commands that exist', () => {
    const commands = readFileSync('src/ui/commands.ts', 'utf8');
    for (const { command } of SHORTCUTS) if (command) expect(commands, command).toContain(`'${command}'`);
  });

  it.each([
    ['Cmd/Ctrl+K', '⌘K', 'Ctrl+K'],
    ['Cmd/Ctrl+Shift+S', '⇧⌘S', 'Ctrl+Shift+S'],
    ['Cmd/Ctrl+Alt+1, 2, 3', '⌥⌘1, 2, 3', 'Ctrl+Alt+1, 2, 3'],
    ['Cmd+= (or Cmd++), Cmd+-, Cmd+0', '⌘= (or ⌘+), ⌘-, ⌘0', 'Cmd+= (or Cmd++), Cmd+-, Cmd+0'],
    ['Alt+Shift+Arrow keys', '⌥⇧Arrow keys', 'Alt+Shift+Arrow keys'],
    ['Shift+Space, Ctrl+Space, Cmd/Ctrl+A', '⇧Space, ⌃Space, ⌘A', 'Shift+Space, Ctrl+Space, Ctrl+A'],
    ['Cmd/Ctrl+click', '⌘-click', 'Ctrl+click'],
    ['Enter, F2', 'Enter, F2', 'Enter, F2'],
  ])('shows %j as %j on a Mac and %j elsewhere', (keys, mac, other) => {
    expect(formatKeys(keys, true)).toBe(mac);
    expect(formatKeys(keys, false)).toBe(other);
  });

  const everything = () => true;

  it('shows printing and zoom only where the app has them', () => {
    const actions = (has: (need: 'print' | 'zoom') => boolean) =>
      shortcutSections('en', false, has).flatMap((section) => section.entries.map((entry) => entry.action));
    expect(actions((need) => need === 'print')).toContain('Print or save as PDF');
    expect(actions((need) => need === 'print')).not.toContain('Zoom in, zoom out, actual size');
    expect(actions((need) => need === 'zoom')).toContain('Zoom in, zoom out, actual size');
    expect(actions((need) => need === 'zoom')).not.toContain('Print or save as PDF');
  });

  it('groups the list, capitalizes each action and keeps the note readable', () => {
    const sections = shortcutSections('en', true, everything);
    expect(sections.map((section) => section.name)).toEqual(['General', 'Markdown and HTML', 'Markdown', 'Grid']);
    const edit = sections[3].entries[0];
    expect(edit).toMatchObject({ action: 'Edit a cell', keys: 'Enter, F2', note: 'Or start typing' });
    const zoom = sections[0].entries.find((entry) => entry.action.startsWith('Zoom'))!;
    expect(zoom.note).not.toContain('`');
    expect(zoom.note).not.toContain('Mac app only');
  });

  it('finds an entry by its words, its keys as shown, or its keys as named', () => {
    const find = (query: string, mac = true) =>
      filterSections(shortcutSections('en', mac, everything), query).flatMap((section) => section.entries.map((entry) => entry.action));
    expect(find('bold')).toEqual(['Bold, italic, inline code']);
    expect(find('⌘b')).toContain('Bold, italic, inline code');
    expect(find('cmd+b')).toContain('Bold, italic, inline code');
    expect(find('ctrl+b', false)).toContain('Bold, italic, inline code');
    expect(find('grid resize')).toEqual(['Resize column or row']);
    expect(find('option+b')).toEqual(['Show or hide the formatting bar']);
    expect(find('  ')).toHaveLength(SHORTCUTS.length);
    expect(find('nothing like this')).toEqual([]);
  });

  it('reads in Catalan too', () => {
    const sections = shortcutSections('ca', true, everything);
    expect(sections[3].name).toBe('Graella');
    expect(filterSections(sections, 'negreta')[0].entries[0].action).toBe('Negreta, cursiva, codi en línia');
  });
});

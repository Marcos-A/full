/**
 * Every keyboard shortcut, as the palette's "?" list shows it and as both READMEs' Keyboard tables
 * read: a unit test rebuilds those tables from this list, so a new shortcut goes here first. Loaded
 * with import() when the list opens. It imports nothing at runtime, so the main bundle stays as it is.
 *
 * Keys are written as in the READMEs, `Cmd/Ctrl+Shift+S`, and formatKeys turns them into what the
 * reader presses: ⇧⌘S on a Mac, Ctrl+Shift+S elsewhere.
 */

export type ShortcutLanguage = 'en' | 'ca';
type Text = Record<ShortcutLanguage, string>;

export type ShortcutGroup = 'general' | 'views' | 'markdown' | 'grid';

export interface Shortcut {
  group: ShortcutGroup;
  action: Text;
  keys: string | Text;
  /** Written straight after the keys in the README, so it starts with its own punctuation. */
  note?: Text;
  /** What the list shows instead of the note, or null for nothing, where the note only makes sense on the page. */
  appNote?: Text | null;
  /** Shown only where the app has this: printing on the website, zoom in the Mac app. */
  needs?: 'print' | 'zoom';
  /** The palette command Enter runs from the list, where it applies to the open file. */
  command?: string;
}

/** The group's name in the list, and the prefix its rows have in the README. */
export const GROUPS: Record<ShortcutGroup, { name: Text; prefix: Text }> = {
  general: { name: { en: 'General', ca: 'General' }, prefix: { en: '', ca: '' } },
  views: { name: { en: 'Markdown and HTML', ca: 'Markdown i HTML' }, prefix: { en: 'Markdown and HTML: ', ca: 'Markdown i HTML: ' } },
  markdown: { name: { en: 'Markdown', ca: 'Markdown' }, prefix: { en: 'Markdown: ', ca: 'Markdown: ' } },
  grid: { name: { en: 'Grid', ca: 'Graella' }, prefix: { en: 'Grid: ', ca: 'Graella: ' } },
};

const GROUP_ORDER: ShortcutGroup[] = ['general', 'views', 'markdown', 'grid'];

/** In README order. */
export const SHORTCUTS: Shortcut[] = [
  { group: 'general', action: { en: 'Command palette', ca: "Paleta d'ordres" }, keys: 'Cmd/Ctrl+K' },
  {
    group: 'general',
    action: { en: 'This list of shortcuts', ca: 'Aquesta llista de dreceres' },
    keys: 'Cmd/Ctrl+?',
    note: { en: ', or ? in the palette', ca: ', o ? a la paleta' },
  },
  { group: 'general', action: { en: 'Open file', ca: 'Obre un fitxer' }, keys: 'Cmd/Ctrl+O', command: 'open' },
  {
    group: 'general',
    action: { en: 'New file', ca: 'Fitxer nou' },
    keys: 'Alt+N',
    note: { en: ', and also Cmd+N in the Mac app', ca: ", i també Cmd+N a l'app de Mac" },
    command: 'new-file',
  },
  { group: 'general', action: { en: 'New Markdown, CSV or text file', ca: 'Fitxer Markdown, CSV o de text nou' }, keys: 'Alt+M, Alt+C, Alt+T' },
  { group: 'general', action: { en: 'Save, Save As', ca: 'Desa, anomena i desa' }, keys: 'Cmd/Ctrl+S, Cmd/Ctrl+Shift+S' },
  { group: 'general', action: { en: 'Undo, Redo', ca: 'Desfés, refés' }, keys: 'Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z' },
  { group: 'general', action: { en: 'Select all text', ca: 'Selecciona tot el text' }, keys: 'Cmd/Ctrl+A' },
  { group: 'general', action: { en: 'Close file', ca: 'Tanca el fitxer' }, keys: 'Alt+W', command: 'close' },
  {
    group: 'views',
    action: { en: 'side by side, source only, rendered only', ca: 'costat a costat, només el codi font, només el resultat' },
    keys: 'Cmd/Ctrl+Alt+1, 2, 3',
  },
  { group: 'markdown', action: { en: 'bold, italic, inline code', ca: 'negreta, cursiva, codi en línia' }, keys: 'Cmd/Ctrl+B, Cmd/Ctrl+I, Cmd/Ctrl+E' },
  {
    group: 'markdown',
    action: { en: 'code block, heading (H1, H2, H3, text)', ca: 'bloc de codi, encapçalament (H1, H2, H3, text)' },
    keys: 'Cmd/Ctrl+Shift+E, Cmd/Ctrl+Alt+H',
  },
  { group: 'markdown', action: { en: 'numbered list, bullets, quote', ca: 'llista numerada, llista amb pics, cita' }, keys: 'Cmd/Ctrl+Shift+7, 8, 9' },
  { group: 'markdown', action: { en: 'link', ca: 'enllaç' }, keys: 'Cmd/Ctrl+Alt+K' },
  {
    group: 'markdown',
    action: { en: 'show or hide the formatting bar', ca: 'mostra o amaga la barra de format' },
    keys: 'Alt+B',
    command: 'format-bar',
  },
  {
    group: 'general',
    action: { en: 'Print or save as PDF', ca: 'Imprimeix o desa com a PDF' },
    keys: 'Cmd/Ctrl+P',
    note: { en: ', website only for now', ca: ', de moment només al lloc web' },
    appNote: null,
    needs: 'print',
    command: 'export-pdf',
  },
  {
    group: 'general',
    action: { en: 'Zoom in, zoom out, actual size', ca: 'Augmenta el zoom, redueix-lo, mida real' },
    keys: { en: 'Cmd+= (or Cmd++), Cmd+-, Cmd+0', ca: 'Cmd+= (o Cmd++), Cmd+-, Cmd+0' },
    note: {
      en: ", Mac app only (the website uses the browser's zoom). On keyboards where `=` needs Shift, as in Spanish and Catalan, Cmd+Shift+0 zooms in too",
      ca: ", només a l'app per a Mac (el lloc web fa servir el zoom del navegador). Als teclats on `=` necessita Majúscules, com el català i l'espanyol, Cmd+Shift+0 també augmenta el zoom",
    },
    appNote: {
      en: 'Where = needs Shift, as in Spanish and Catalan, Cmd+Shift+0 zooms in too',
      ca: 'On = necessita Majúscules, com en català i en espanyol, Cmd+Shift+0 també augmenta el zoom',
    },
    needs: 'zoom',
  },
  {
    group: 'general',
    action: { en: 'Open a link in a file you can edit on the rendered side', ca: 'Obre un enllaç en un fitxer que pots editar a la banda amb format' },
    keys: { en: 'Cmd/Ctrl+click', ca: 'Cmd/Ctrl+clic' },
    note: {
      en: ' (in a read-only file, a plain click), or right-click and "Open Link" in the Mac app',
      ca: " (en un fitxer només de lectura, un clic normal), o clic dret i «Open Link» a l'app per a Mac",
    },
  },
  {
    group: 'grid',
    action: { en: 'edit a cell', ca: 'edita una cel·la' },
    keys: 'Enter, F2',
    note: { en: ', or start typing', ca: ' o comença a escriure' },
  },
  { group: 'grid', action: { en: 'new line inside a cell', ca: "línia nova dins d'una cel·la" }, keys: 'Alt+Enter' },
  {
    group: 'grid',
    action: { en: 'select row, column, all', ca: 'selecciona fila, columna, tot' },
    keys: { en: 'Shift+Space, Ctrl+Space, Cmd/Ctrl+A', ca: 'Shift+Espai, Ctrl+Espai, Cmd/Ctrl+A' },
  },
  {
    group: 'grid',
    action: { en: 'move rows or columns', ca: 'mou files o columnes' },
    keys: '',
    note: {
      en: '"Move selected…" commands in the palette',
      ca: 'Ordres «Mou les files seleccionades…» i «Mou les columnes seleccionades…» de la paleta',
    },
  },
  {
    group: 'grid',
    action: { en: 'resize column or row', ca: 'redimensiona la columna o la fila' },
    keys: { en: 'Alt+Shift+Arrow keys', ca: 'Alt+Shift+Fletxes' },
    note: { en: ', or drag its edge', ca: ", o arrossega'n la vora" },
  },
  {
    group: 'grid',
    action: { en: 'fit column or row to its content', ca: 'ajusta la columna o la fila al contingut' },
    keys: { en: 'Double-click its edge', ca: 'Doble clic a la vora' },
  },
  {
    group: 'grid',
    action: { en: 'insert or delete selected rows or columns', ca: 'insereix o elimina les files o columnes seleccionades' },
    keys: 'Cmd/Ctrl+Alt+=, Cmd/Ctrl+Alt+-',
  },
];

const keysOf = (shortcut: Shortcut, lang: ShortcutLanguage) =>
  typeof shortcut.keys === 'string' ? shortcut.keys : shortcut.keys[lang];

/** The README's Keyboard table rows, `| Action | Keys |`, without the header. */
export function readmeRows(lang: ShortcutLanguage): string[] {
  return SHORTCUTS.map((s) => `| ${GROUPS[s.group].prefix[lang]}${s.action[lang]} | ${keysOf(s, lang)}${s.note?.[lang] ?? ''} |`);
}

const MODIFIERS = /(?:(?:Cmd\/Ctrl|Cmd|Ctrl|Alt|Shift)\+)+(?=.)/g;
const MAC_ORDER = ['Ctrl', 'Alt', 'Shift', 'Cmd'];
const MAC_SYMBOLS: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Shift: '⇧', Cmd: '⌘' };

/** Keys as the reader presses them: Apple's symbols in Apple's order on a Mac, Ctrl for Cmd/Ctrl elsewhere. */
export function formatKeys(keys: string, mac: boolean): string {
  return keys.replace(MODIFIERS, (run: string, offset: number) => {
    const names = run
      .slice(0, -1)
      .split('+')
      .map((name) => (name === 'Cmd/Ctrl' ? (mac ? 'Cmd' : 'Ctrl') : name));
    if (!mac) return `${names.join('+')}+`;
    const symbols = MAC_ORDER.filter((name) => names.includes(name))
      .map((name) => MAC_SYMBOLS[name])
      .join('');
    // ⌘-click, as Apple writes it, but ⌘B.
    return /[a-z]/.test(keys[offset + run.length]) ? `${symbols}-` : symbols;
  });
}

export interface ShortcutEntry {
  group: string;
  action: string;
  keys: string;
  note: string;
  command?: string;
  /** Everything a search can match: the words, the keys as written and as shown, and their names. */
  haystack: string;
}

export interface ShortcutSection {
  name: string;
  entries: ShortcutEntry[];
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The list for this reader, grouped. `has` says whether the app here prints or zooms. */
export function shortcutSections(lang: ShortcutLanguage, mac: boolean, has: (need: 'print' | 'zoom') => boolean): ShortcutSection[] {
  return GROUP_ORDER.map((group) => {
    const name = GROUPS[group].name[lang];
    const entries = SHORTCUTS.filter((s) => s.group === group && (!s.needs || has(s.needs))).map((s): ShortcutEntry => {
      const raw = keysOf(s, lang);
      const keys = formatKeys(raw, mac);
      const note = (s.appNote === undefined ? s.note?.[lang] : s.appNote?.[lang]) ?? '';
      const shownNote = capitalize(note.replace(/^[,\s]+/, '').replace(/^\((.*)\)/, '$1').replace(/`/g, ''));
      const action = capitalize(s.action[lang]);
      const names = [raw, raw.replace(/Cmd\/Ctrl/g, 'Cmd'), raw.replace(/Cmd\/Ctrl/g, 'Ctrl'), raw.replace(/Alt/g, 'Option')];
      return {
        group: name,
        action,
        keys,
        note: shownNote,
        command: s.command,
        haystack: [name, action, keys, shownNote, ...names].join(' ').toLowerCase(),
      };
    });
    return { name, entries };
  }).filter((section) => section.entries.length > 0);
}

/** Every word of the query appears somewhere in the entry: "bold", "⌘b", "cmd+b" and "grid resize" all find theirs. */
export function filterSections(sections: ShortcutSection[], query: string): ShortcutSection[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return sections;
  return sections
    .map((section) => ({ ...section, entries: section.entries.filter((entry) => words.every((word) => entry.haystack.includes(word))) }))
    .filter((section) => section.entries.length > 0);
}

import { Delimiter, DELIMITERS } from '../core/csv';
import { ENCODING_LABELS, ENCODINGS } from '../core/encoding';
import { host } from '../platform/host';
import { FORMAT_ACTIONS, formatShortcut } from '../doc/markdownFormat';
import { ACCENTS, ws } from '../doc/workspace';
import { LANGUAGE_CODES, LANGUAGES, S } from '../strings';

export interface Command {
  id: string;
  label: string;
  shortcut?: string;
  group: string;
  run: () => void | Promise<void>;
  /** Accent tone to show beside the label. */
  swatch?: string;
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl+';
const shift = isMac ? '⇧' : 'Shift+';
export const paletteShortcut = `${mod}K`;

/** Opening and creating files: the whole of the "+" menu, and the start of the full list. */
export function startCommands(): Command[] {
  const file = (id: string, label: string, shortcut: string, run: Command['run']): Command => ({
    group: 'File',
    id,
    label,
    shortcut,
    run,
  });
  return [
    file('open', S.openFile, `${mod}O`, () => ws.openPicked()),
    file('new-file', S.newFile, host().newKeyReachesPage ? `${mod}N` : 'Alt+N', () => ws.newFile()),
    file('new-markdown', S.newMarkdown, 'Alt+M', () => ws.newFile('markdown')),
    file('new-csv', S.newCsv, 'Alt+C', () => ws.newFile('csv')),
    file('new-text', S.newText, 'Alt+T', () => ws.newFile('text')),
  ];
}

// Alt, because browsers keep Cmd/Ctrl+N and Cmd/Ctrl+T for themselves.
const START_ALT_KEYS: Record<string, string> = {
  KeyN: 'new-file',
  KeyM: 'new-markdown',
  KeyC: 'new-csv',
  KeyT: 'new-text',
};

/**
 * The opening or creating command this key press asks for. On macOS Ctrl+O and Ctrl+N stay the
 * text editing keys they are there, so only Cmd counts.
 */
export function startCommandForKey(event: KeyboardEvent): Command | undefined {
  if (event.shiftKey) return undefined;
  const primary = isMac ? event.metaKey : event.ctrlKey;
  const secondary = isMac ? event.ctrlKey : event.metaKey;
  let id: string | undefined;
  if (event.altKey) {
    // event.code: on macOS, Option+N is a dead key and Option+C produces "ç".
    if (!primary && !secondary) id = START_ALT_KEYS[event.code];
  } else if (primary && !secondary) {
    const key = event.key.toLowerCase();
    if (key === 'o') id = 'open';
    else if (key === 'n' && host().newKeyReachesPage) id = 'new-file';
  }
  return id ? startCommands().find((command) => command.id === id) : undefined;
}

// Cmd+Option or Ctrl+Alt plus a digit, in menu order. Option or Alt alone would take characters:
// Option+2 and Option+3 type "@" and "#" on Spanish and Catalan Macs.
const VIEW_KEYS: Record<string, string> = {
  Digit1: 'view-split',
  Digit2: 'view-source',
  Digit3: 'view-rendered',
};
const alt = isMac ? '⌥' : 'Alt+';

/**
 * True when Ctrl+Alt is really AltGr typing a character, as on Windows, where AltGr+2 is "@" on a
 * Spanish keyboard. Then the key isn't a shortcut. On a Mac, Cmd held means nothing is typed.
 */
export const typesCharacter = (event: KeyboardEvent, plain: string): boolean =>
  !isMac && event.key.toLowerCase() !== plain;

/**
 * Zoom in (1), out (-1) or back to actual size (0), by the character the key types, as browsers
 * do. The menu's Cmd+= can't be reached the same way everywhere: on Spanish and Catalan Macs "=" is
 * Shift+0, which macOS matches as Cmd+0, Actual Size, and "+" is a key of its own. So "=" and "+"
 * both zoom in, and Shift+0 never resets. In case WebKit reports a shifted digit under Cmd as the
 * digit itself, that counts as "=" too.
 */
export function zoomStepForKey(event: KeyboardEvent): 1 | -1 | 0 | undefined {
  const primary = isMac ? event.metaKey : event.ctrlKey;
  const secondary = isMac ? event.ctrlKey : event.metaKey;
  if (!primary || secondary || event.altKey) return undefined;
  const { key, code, shiftKey } = event;
  if (key === '=' || key === '+' || (shiftKey && code === 'Digit0' && key === '0')) return 1;
  if (key === '-') return -1;
  if (!shiftKey && (key === '0' || code === 'Digit0')) return 0;
  return undefined;
}

/** The Markdown or HTML view this key press asks for, from the source side or the rendered side alike. */
export function viewCommandForKey(event: KeyboardEvent): Command | undefined {
  const primary = isMac ? event.metaKey : event.ctrlKey;
  const secondary = isMac ? event.ctrlKey : event.metaKey;
  if (!primary || secondary || !event.altKey || event.shiftKey) return undefined;
  const id = VIEW_KEYS[event.code];
  if (!id || typesCharacter(event, event.code.slice(-1))) return undefined;
  return buildCommands().find((command) => command.id === id);
}

/** The one list behind both the palette and the menu, so they can never differ. */
export function buildCommands(): Command[] {
  const doc = ws.active;
  const commands = startCommands();
  const add = (group: string, id: string, label: string, run: Command['run'], shortcut?: string) =>
    commands.push({ group, id, label, run, shortcut });

  if (doc) {
    const fileApi = host().canOverwrite;
    add('File', 'save', fileApi ? S.save : S.download, () => void ws.save(doc), `${mod}S`);
    add('File', 'save-as', fileApi ? S.saveAs : S.downloadAs, () => void ws.save(doc, { as: true }), `${mod}${shift}S`);
    if (doc.dirty) add('File', 'revert', S.revert, () => ws.revert(doc));
    // The export code loads only when an export runs.
    const exportAs = (format: 'html' | 'xlsx' | 'pdf') => () =>
      import('../export/run').then(({ runExport }) => runExport(doc, format, (kind, text) => ws.notify(kind, text)));
    if (doc.kind === 'markdown') add('File', 'export-html', S.exportHtml, exportAs('html'));
    if (doc.kind !== 'csv' && host().canPrint) add('File', 'export-pdf', S.exportPdf, exportAs('pdf'), `${mod}P`);
    if (doc.kind === 'csv') add('File', 'export-xlsx', S.exportXlsx, exportAs('xlsx'));
    add('File', 'close', S.closeFile, () => void ws.closeDoc(doc), 'Alt+W');
    if (ws.tabStrip().length > 1) {
      add('File', 'next-tab', S.nextTab, () => ws.cycleTab(1));
      add('File', 'previous-tab', S.previousTab, () => ws.cycleTab(-1));
    }

    add('Edit', 'undo', S.undo, () => doc.undo(), `${mod}Z`);
    add('Edit', 'redo', S.redo, () => doc.redo(), `${mod}${shift}Z`);

    const grid = doc.kind === 'csv' && doc.csvMode === 'grid' ? doc.gridApi : null;
    if (doc.kind === 'markdown') {
      add('Copy', 'copy-source', S.copySource, () => ws.copySource(doc));
      add('Copy', 'copy-rendered', S.copyRendered, () => ws.copyRendered(doc));
    } else if (doc.kind === 'text') {
      add('Copy', 'copy-text', S.copyFileText, () => ws.copySource(doc));
    } else if (grid) {
      add('Copy', 'copy-selection', S.copySelection, () => ws.copyValues(grid.selectionValues()), `${mod}C`);
      add('Copy', 'copy-table', S.copyTable, () => ws.copyValues(grid.allValues()));
      add('Edit', 'cut', S.cut, () => grid.cutSelection(), `${mod}X`);
      add(
        'Edit',
        'paste',
        S.paste,
        async () => {
          try {
            grid.pasteText(await navigator.clipboard.readText());
          } catch {
            ws.notify('error', S.pasteFailed);
          }
        },
        `${mod}V`,
      );
    } else {
      add('Copy', 'copy-source', S.copySource, () => ws.copySource(doc));
    }

    if (doc.previewable) {
      add('View', 'view-split', S.viewSplit, () => doc.setViewMode('split'), `${isMac ? alt + mod : mod + alt}1`);
      add('View', 'view-source', S.viewSource, () => doc.setViewMode('source'), `${isMac ? alt + mod : mod + alt}2`);
      add('View', 'view-rendered', S.viewRendered, () => doc.setViewMode('rendered'), `${isMac ? alt + mod : mod + alt}3`);
      add(
        'View',
        'remote-images',
        doc.remoteImages ? S.blockRemoteImages : S.loadRemoteImages,
        () => doc.setRemoteImages(!doc.remoteImages),
      );
    }
    if (doc.kind !== 'csv') add('View', 'wrap', S.toggleWrap, () => doc.setWrap(!doc.wrap));
    if (doc.kind === 'markdown') {
      add('View', 'format-bar', ws.formatBar ? S.hideFormatBar : S.showFormatBar, () => ws.toggleFormatBar(), 'Alt+B');
      for (const action of FORMAT_ACTIONS) {
        add('Format', `format-${action}`, S.formatCommand(S.formatNames[action]), () => ws.format(action), formatShortcut(action));
      }
    }

    if (doc.kind === 'csv') {
      if (doc.csvMode === 'grid') {
        add('View', 'view-raw', S.viewRaw, () => void doc.setCsvMode('raw'));
        add('View', 'toggle-header', S.toggleHeader, () => {
          doc.headerRow = !doc.headerRow;
          ws.bump();
        });
      } else {
        add('View', 'view-grid', S.viewGrid, () => {
          const line = doc.setCsvMode('grid');
          if (line !== null) ws.notify('error', S.csvStillMalformed(line));
        });
      }
      if (grid) {
        add('Table', 'select-all', S.selectAll, () => grid.selectAll(), `${mod}A`);
        add('Table', 'row-above', S.insertRowAbove, () => grid.insertRow('above'));
        add('Table', 'row-below', S.insertRowBelow, () => grid.insertRow('below'));
        add('Table', 'row-delete', S.deleteRows, () => grid.deleteRows());
        add('Table', 'rows-up', S.moveRowsUp, () => grid.moveRows(-1));
        add('Table', 'rows-down', S.moveRowsDown, () => grid.moveRows(1));
        add('Table', 'column-left', S.insertColumnLeft, () => grid.insertColumn('left'));
        add('Table', 'column-right', S.insertColumnRight, () => grid.insertColumn('right'));
        add('Table', 'column-delete', S.deleteColumns, () => grid.deleteColumns());
      }
      if (grid) {
        add('Table', 'columns-left', S.moveColumnsLeft, () => grid.moveColumns(-1));
        add('Table', 'columns-right', S.moveColumnsRight, () => grid.moveColumns(1));
        add('Table', 'fit-rows', S.fitRows, () => grid.fitRows());
        add('Table', 'fit-columns', S.fitColumns, () => grid.fitColumns());
      }
      for (const delimiter of DELIMITERS) {
        const name = S.delimiterNames[delimiter];
        add('Table', `delimiter-${delimiter}`, S.delimiterCommand(name), () => {
          if (!doc.setDelimiter(delimiter as Delimiter)) ws.notify('error', S.delimiterFailed(name));
        });
      }
    }

    for (const encoding of ENCODINGS) {
      add('File', `encoding-${encoding}`, S.reopenWith(ENCODING_LABELS[encoding]), () => ws.reopenWith(doc, encoding));
    }
  }
  if (ws.recovery.length > 0) {
    add('File', 'recover', S.recoverFiles, () => {
      ws.recoveryDialogOpen = true;
      ws.bump();
    });
  }
  // The palette switches to its shortcut list rather than closing (see CommandPalette).
  add(
    'Help',
    'shortcuts',
    S.keyboardShortcuts,
    () => {
      ws.paletteQuery = '?';
      ws.bump();
    },
    `${mod}?`,
  );
  for (const code of LANGUAGE_CODES) {
    add('Language', `language-${code}`, S.languageCommand(LANGUAGES[code]), () => ws.applyLanguage(code));
  }
  for (const accent of ACCENTS) {
    add('Theme', `accent-${accent}`, S.accentCommand(S.accentNames[accent]), () => ws.applyAccent(accent));
    commands[commands.length - 1].swatch = accent;
  }
  if (host().setZoom) {
    add('View', 'zoom-in', S.zoomIn, () => ws.stepZoom(1), `${mod}=`);
    add('View', 'zoom-out', S.zoomOut, () => ws.stepZoom(-1), `${mod}-`);
    add('View', 'zoom-reset', S.zoomReset, () => ws.applyZoom(1), `${mod}0`);
  }
  add('Theme', 'theme-system', S.themeSystem, () => ws.applyTheme('system'));
  add('Theme', 'theme-dark', S.themeDark, () => ws.applyTheme('dark'));
  add('Theme', 'theme-light', S.themeLight, () => ws.applyTheme('light'));
  return commands;
}

export function runCommand(command: Command): void {
  void Promise.resolve(command.run()).catch((error: unknown) => {
    console.error(error);
    ws.notify('error', String(error));
  });
}

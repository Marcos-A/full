import { Delimiter, DELIMITERS } from '../core/csv';
import { ENCODING_LABELS, ENCODINGS } from '../core/encoding';
import { host } from '../platform/host';
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
  const file = (id: string, label: string, run: Command['run']): Command => ({ group: 'File', id, label, run });
  return [
    file('open', S.openFile, () => ws.openPicked()),
    file('new-markdown', S.newMarkdown, () => ws.newFile('markdown')),
    file('new-csv', S.newCsv, () => ws.newFile('csv')),
    file('new-text', S.newText, () => ws.newFile('text')),
  ];
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
    add('File', 'close', S.closeFile, () => void ws.closeDoc(doc), 'Alt+W');
    if (ws.docs.length > 1) {
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

    if (doc.kind === 'markdown') {
      add('View', 'view-split', S.viewSplit, () => doc.setViewMode('split'));
      add('View', 'view-source', S.viewSource, () => doc.setViewMode('source'));
      add('View', 'view-rendered', S.viewRendered, () => doc.setViewMode('rendered'));
      add(
        'View',
        'remote-images',
        doc.remoteImages ? S.blockRemoteImages : S.loadRemoteImages,
        () => doc.setRemoteImages(!doc.remoteImages),
      );
    }
    if (doc.kind !== 'csv') add('View', 'wrap', S.toggleWrap, () => doc.setWrap(!doc.wrap));

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
  for (const code of LANGUAGE_CODES) {
    add('Language', `language-${code}`, S.languageCommand(LANGUAGES[code]), () => ws.applyLanguage(code));
  }
  for (const accent of ACCENTS) {
    add('Theme', `accent-${accent}`, S.accentCommand(S.accentNames[accent]), () => ws.applyAccent(accent));
    commands[commands.length - 1].swatch = accent;
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

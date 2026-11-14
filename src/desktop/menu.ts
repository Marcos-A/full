import { ws } from '../doc/workspace';
import { language } from '../strings';
import { buildCommands, runCommand } from '../ui/commands';

/** The menu items that are the page's. Native code has the same list, and a unit test compares them. */
export const MENU_COMMANDS = [
  'new-file', 'new-markdown', 'new-csv', 'new-text', 'open', 'save', 'save-as', 'revert', 'export-html', 'export-xlsx', 'recover',
  'undo', 'redo', 'select-all',
  'view-split', 'view-source', 'view-rendered', 'view-grid', 'view-raw', 'wrap', 'toggle-header', 'remote-images', 'format-bar', 'palette',
  'row-above', 'row-below', 'row-delete', 'rows-up', 'rows-down',
  'column-left', 'column-right', 'column-delete', 'columns-left', 'columns-right',
  'next-tab', 'previous-tab', 'zoom-in', 'zoom-out', 'zoom-reset', 'shortcuts',
] as const;

const modalOpen = () => ws.dialog !== null || ws.recoveryDialogOpen;

/** These have to work in text fields, even in a dialog, and a Mac app only gets them from its menu. */
const FIELD_EDITS: Record<string, string> = { undo: 'undo', redo: 'redo', 'select-all': 'selectAll' };

/** Fields that keep WebKit's own editing, as the page's shortcuts leave them to it. */
const inTextField = () => Boolean((document.activeElement as HTMLElement | null)?.closest?.('.grid-editor, input, .cm-panels'));

function togglePalette(): void {
  ws.paletteQuery = ws.paletteQuery === null ? '' : null;
  ws.bump();
}

/** A menu click, or a shortcut the page didn't take. Holds to the same rule as the keyboard: nothing behind a dialog. */
export function runMenuCommand(id: string): void {
  if (id in FIELD_EDITS && inTextField()) {
    document.execCommand(FIELD_EDITS[id]);
    return;
  }
  if (modalOpen()) return;
  if (id === 'palette') {
    togglePalette();
    return;
  }
  if (ws.paletteQuery !== null) return;
  const command = buildCommands().find((candidate) => candidate.id === id);
  if (command) runCommand(command);
  // Only a table has its own Select All. Elsewhere it's the text in the focused editor.
  else if (id === 'select-all') document.execCommand('selectAll');
}

export interface MenuState {
  language: string;
  enabled: string[];
  checked: string[];
}

function checkedItems(): string[] {
  const doc = ws.active;
  if (!doc) return [];
  if (doc.previewable) {
    return [
      `view-${doc.viewMode}`,
      ...(doc.remoteImages ? ['remote-images'] : []),
      ...(doc.wrap ? ['wrap'] : []),
      ...(doc.kind === 'markdown' && ws.formatBar ? ['format-bar'] : []),
    ];
  }
  if (doc.kind === 'csv') return [`view-${doc.csvMode}`, ...(doc.csvMode === 'grid' && doc.headerRow ? ['toggle-header'] : [])];
  return doc.wrap ? ['wrap'] : [];
}

export function menuState(): MenuState {
  const checked = checkedItems();
  if (modalOpen()) return { language, enabled: Object.keys(FIELD_EDITS), checked };
  const available = new Set<string>(buildCommands().map((command) => command.id));
  available.add('palette');
  if (ws.active || ws.paletteQuery !== null) available.add('select-all');
  // The view in use has no command, as switching to it would do nothing, but it stays readable.
  const enabled = MENU_COMMANDS.filter((id) => available.has(id) || checked.includes(id));
  return { language, enabled, checked };
}

/** Tells native code what the menu should show, whenever that changes. */
export function keepMenuUpToDate(send: (state: MenuState) => void, timed: <T>(run: () => T) => T = (run) => run()): void {
  let sent = '';
  let waiting = false;
  const sync = () => {
    waiting = false;
    const state = timed(menuState);
    const text = JSON.stringify(state);
    if (text !== sent) {
      sent = text;
      send(state);
    }
  };
  ws.subscribe(() => {
    if (waiting) return;
    waiting = true;
    setTimeout(sync, 50);
  });
  sync();
}

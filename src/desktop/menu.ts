import { ws } from '../doc/workspace';
import { language } from '../strings';
import { buildCommands, runCommand } from '../ui/commands';

/** The menu items that are the page's. Native code has the same list, and a unit test compares them. */
export const MENU_COMMANDS = [
  'new-markdown', 'new-csv', 'new-text', 'open', 'save', 'save-as', 'revert', 'recover', 'undo', 'redo',
  'view-split', 'view-source', 'view-rendered', 'view-grid', 'view-raw', 'wrap', 'toggle-header', 'remote-images', 'palette',
  'row-above', 'row-below', 'row-delete', 'rows-up', 'rows-down',
  'column-left', 'column-right', 'column-delete', 'columns-left', 'columns-right',
  'next-tab', 'previous-tab',
] as const;

const modalOpen = () => ws.dialog !== null || ws.recoveryDialogOpen;

/** Fields that keep WebKit's own undo, as the page's Cmd+Z handler leaves them to it. */
const inTextField = () => Boolean((document.activeElement as HTMLElement | null)?.closest?.('.grid-editor, input, .cm-panels'));

function togglePalette(): void {
  ws.paletteQuery = ws.paletteQuery === null ? '' : null;
  ws.bump();
}

/** A menu click, or a shortcut the page didn't take. Holds to the same rule as the keyboard: nothing behind a dialog. */
export function runMenuCommand(id: string): void {
  if (modalOpen()) return;
  if (id === 'palette') {
    togglePalette();
    return;
  }
  if (ws.paletteQuery !== null) return;
  if ((id === 'undo' || id === 'redo') && inTextField()) {
    document.execCommand(id);
    return;
  }
  const command = buildCommands().find((candidate) => candidate.id === id);
  if (command) runCommand(command);
}

export interface MenuState {
  language: string;
  enabled: string[];
  checked: string[];
}

function checkedItems(): string[] {
  const doc = ws.active;
  if (!doc) return [];
  if (doc.kind === 'markdown') {
    return [`view-${doc.viewMode}`, ...(doc.remoteImages ? ['remote-images'] : []), ...(doc.wrap ? ['wrap'] : [])];
  }
  if (doc.kind === 'csv') return [`view-${doc.csvMode}`, ...(doc.csvMode === 'grid' && doc.headerRow ? ['toggle-header'] : [])];
  return doc.wrap ? ['wrap'] : [];
}

export function menuState(): MenuState {
  const checked = checkedItems();
  if (modalOpen()) return { language, enabled: [], checked };
  const available = new Set<string>(buildCommands().map((command) => command.id));
  available.add('palette');
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

/**
 * The Markdown formatting bar, loaded with import() the first time it's shown. Plain DOM built
 * once, never re-rendered on edits. It imports nothing from the app: what it shows and what its
 * buttons do are handed in, so it never changes how the main bundle is split.
 */

export interface FormatBarItem {
  action: string;
  label: string;
  shortcut: string;
}

/** Plain text in the system font, so nothing draws in colour or needs loading. */
const GLYPHS: Record<string, string> = {
  bold: 'B',
  italic: 'I',
  code: '`',
  codeBlock: '{ }',
  heading: 'H',
  bullets: '•',
  numbers: '1.',
  quote: '“',
  link: '[ ]',
};

export interface FormatBar {
  element: HTMLElement;
  localize(label: string, items: FormatBarItem[]): void;
}

export function createFormatBar(run: (action: string) => void, leave: () => void): FormatBar {
  const bar = document.createElement('div');
  bar.className = 'format-bar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-orientation', 'horizontal');
  bar.dataset.testid = 'format-bar';
  const buttons = new Map<string, HTMLButtonElement>();
  for (const action of Object.keys(GLYPHS)) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `format-button format-${action}`;
    button.dataset.action = action;
    button.textContent = GLYPHS[action];
    button.tabIndex = buttons.size === 0 ? 0 : -1;
    buttons.set(action, button);
    bar.append(button);
  }
  const list = () => Array.from(buttons.values());

  // A click keeps the focus and the selection where they are, in the file.
  bar.addEventListener('mousedown', (event) => {
    if ((event.target as Element).closest('button')) event.preventDefault();
  });
  bar.addEventListener('click', (event) => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button');
    if (button?.dataset.action) run(button.dataset.action);
  });
  // One Tab stop, and arrow keys inside, as a toolbar has.
  bar.addEventListener('keydown', (event) => {
    const items = list();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      leave();
      return;
    } else return;
    event.preventDefault();
    for (const item of items) item.tabIndex = -1;
    items[next].tabIndex = 0;
    items[next].focus();
    items[next].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });

  return {
    element: bar,
    localize(label, items) {
      bar.setAttribute('aria-label', label);
      for (const item of items) {
        const button = buttons.get(item.action);
        if (!button) continue;
        button.title = `${item.label} (${item.shortcut})`;
        button.setAttribute('aria-label', item.label);
        button.setAttribute('aria-keyshortcuts', item.shortcut.replace(/⌘/g, 'Meta+').replace(/⌥/g, 'Alt+').replace(/⇧/g, 'Shift+').replace(/Ctrl/g, 'Control'));
      }
    },
  };
}

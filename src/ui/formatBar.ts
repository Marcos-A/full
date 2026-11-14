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

/**
 * Line icons drawn in currentColor on a 16px grid, inline so nothing needs loading. The groups are
 * inline marks, blocks, lists and the link; a hairline divider sits between groups.
 */
const GROUPS: string[][] = [
  ['bold', 'italic', 'code'],
  ['heading', 'quote', 'codeBlock'],
  ['bullets', 'numbers'],
  ['link'],
];

const ICONS: Record<string, string> = {
  bold: '<path d="M4.75 3h4a2.5 2.5 0 0 1 0 5h-4zM4.75 8h4.75a2.5 2.5 0 0 1 0 5H4.75z" stroke-width="1.75"/>',
  italic: '<path d="M7 3h5M4 13h5M10 3 6.5 13"/>',
  code: '<path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5"/>',
  heading: '<path d="M3 3.5v9M9 3.5v9M3 8h6M11.5 9.5 13 8.5v4"/>',
  quote: '<path d="M3 3.5v9M6.5 5H13M6.5 8H13M6.5 11h4"/>',
  codeBlock:
    '<rect x="2" y="2.75" width="12" height="10.5" rx="2"/><path d="M6.25 6.5 4.75 8l1.5 1.5M9.75 6.5l1.5 1.5-1.5 1.5"/>',
  bullets:
    '<path d="M6.5 4.5h7M6.5 8h7M6.5 11.5h7"/><g fill="currentColor" stroke="none"><circle cx="3" cy="4.5" r="1.1"/><circle cx="3" cy="8" r="1.1"/><circle cx="3" cy="11.5" r="1.1"/></g>',
  numbers:
    '<path d="M7 4.5h6.5M7 8h6.5M7 11.5h6.5M2.5 3.25 3.5 2.75v3.25M2.25 9.6c.2-.6.7-.85 1.2-.85.6 0 1 .4 1 .9 0 .85-2.2 1.5-2.2 2.6h2.25"/>',
  link: '<path d="M6.5 9.5l3-3M7.25 4.75l.9-.9a2.6 2.6 0 0 1 3.7 3.7l-.9.9M8.75 11.25l-.9.9a2.6 2.6 0 0 1-3.7-3.7l.9-.9"/>',
};

const icon = (body: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

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
  GROUPS.forEach((group, index) => {
    if (index > 0) {
      const divider = document.createElement('span');
      divider.className = 'format-divider';
      divider.setAttribute('aria-hidden', 'true');
      bar.append(divider);
    }
    for (const action of group) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `format-button format-${action}`;
      button.dataset.action = action;
      button.innerHTML = icon(ICONS[action]);
      button.tabIndex = buttons.size === 0 ? 0 : -1;
      buttons.set(action, button);
      bar.append(button);
    }
  });
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

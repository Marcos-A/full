import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyScore } from '../core/fuzzy';
import { ws } from '../doc/workspace';
import { host } from '../platform/host';
import { language, S } from '../strings';
import { buildCommands, Command, paletteShortcut, runCommand, startCommands } from './commands';
import type { ShortcutEntry } from './shortcuts';

function CommandLabel({ command }: { command: Command }) {
  return (
    <span className="command-label">
      {command.swatch && <i className="swatch" data-accent={command.swatch} />}
      {command.label}
    </span>
  );
}

type ShortcutsModule = typeof import('./shortcuts');
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/**
 * The palette lists commands, or every keyboard shortcut once the query starts with "?". The
 * shortcut list loads on first use, and Enter on a shortcut runs its command where one applies.
 */
export function CommandPalette({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(0);
  const [shortcuts, setShortcuts] = useState<ShortcutsModule | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const commands = useMemo(() => buildCommands(), []);
  const shortcutMode = query.startsWith('?');

  const matches = useMemo(() => {
    if (shortcutMode) return [];
    if (!query.trim()) return commands;
    return commands
      // Tones that match equally stay in ACCENTS order, whatever the length of their names.
      .map((command) => ({ command, score: fuzzyScore(query, command.label, Boolean(command.swatch)) }))
      .filter((m): m is { command: Command; score: number } => m.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((m) => m.command);
  }, [commands, query, shortcutMode]);

  useEffect(() => {
    if (shortcutMode && !shortcuts) void import('./shortcuts').then((module) => setShortcuts(module));
  }, [shortcutMode, shortcuts]);

  const sections = useMemo(() => {
    if (!shortcutMode || !shortcuts) return [];
    const has = (need: 'print' | 'zoom') => Boolean(need === 'print' ? host().canPrint : host().setZoom);
    return shortcuts.filterSections(shortcuts.shortcutSections(language, isMac, has), query.slice(1));
  }, [shortcutMode, shortcuts, query]);
  const entries = useMemo(() => sections.flatMap((section) => section.entries), [sections]);
  const count = shortcutMode ? entries.length : matches.length;

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selected, sections]);

  const close = (focus: boolean) => {
    ws.paletteQuery = null;
    ws.bump();
    if (focus) requestAnimationFrame(() => ws.active?.focus());
  };
  const run = (command: Command | undefined) => {
    if (!command) return;
    if (command.id === 'shortcuts') {
      setQuery('?');
      setSelected(0);
      return;
    }
    close(true);
    runCommand(command);
  };
  const commandOf = (entry: ShortcutEntry | undefined) =>
    entry?.command ? commands.find((command) => command.id === entry.command) : undefined;
  const choose = (index: number) => (shortcutMode ? run(commandOf(entries[index])) : run(matches[index]));
  const activeId = shortcutMode
    ? entries[selected] && `shortcut-${selected}`
    : matches[selected] && `palette-${matches[selected].id}`;

  let index = 0;
  return (
    <dialog
      ref={dialogRef}
      className="palette"
      data-testid="palette"
      aria-label={shortcutMode ? S.keyboardShortcuts : S.menu}
      onCancel={(event) => {
        event.preventDefault();
        close(true);
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) close(true);
      }}
    >
      <input
        className="palette-input"
        autoFocus
        role="combobox"
        aria-expanded="true"
        aria-controls="palette-list"
        aria-activedescendant={activeId || undefined}
        aria-label={shortcutMode ? S.searchShortcuts : S.commandPlaceholder}
        placeholder={S.commandPlaceholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelected((s) => Math.min(s + 1, count - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected((s) => Math.max(s - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            choose(selected);
          }
        }}
      />
      <ul id="palette-list" role="listbox" ref={listRef} className="palette-list">
        {!shortcutMode &&
          matches.map((command, at) => (
            <li
              key={command.id}
              id={`palette-${command.id}`}
              role="option"
              aria-selected={at === selected}
              className={at === selected ? 'selected' : ''}
              onMouseMove={() => setSelected(at)}
              onClick={() => run(command)}
            >
              <CommandLabel command={command} />
              {command.shortcut && <kbd>{command.shortcut}</kbd>}
            </li>
          ))}
        {sections.map((section) => (
          <Fragment key={section.name}>
            <li role="presentation" className="palette-group">
              {section.name}
            </li>
            {section.entries.map((entry) => {
              const at = index++;
              const runnable = Boolean(commandOf(entry));
              return (
                <li
                  key={at}
                  id={`shortcut-${at}`}
                  role="option"
                  aria-selected={at === selected}
                  className={`shortcut${at === selected ? ' selected' : ''}${runnable ? '' : ' inert'}`}
                  onMouseMove={() => setSelected(at)}
                  onClick={() => choose(at)}
                >
                  <span className="command-label">
                    {entry.action}
                    {entry.note && <small className="shortcut-note">{entry.note}</small>}
                  </span>
                  {entry.keys && <kbd>{entry.keys}</kbd>}
                </li>
              );
            })}
          </Fragment>
        ))}
        {count === 0 && (!shortcutMode || shortcuts) && (
          <li className="palette-none">{shortcutMode ? S.noShortcuts : S.noCommands}</li>
        )}
      </ul>
    </dialog>
  );
}

interface ButtonMenuProps {
  glyph: string;
  label: string;
  title: string;
  testId: string;
  compact?: boolean;
  listCommands: () => Command[];
}

function ButtonMenu({ glyph, label, title, testId, compact, listCommands }: ButtonMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const commands = open ? listCommands() : [];

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('mousedown', onPointer);
    return () => window.removeEventListener('mousedown', onPointer);
  }, [open]);

  const onMenuKey = (event: React.KeyboardEvent) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const focus = (i: number) => items[(i + items.length) % items.length]?.focus();
    if (event.key === 'ArrowDown') focus(index + 1);
    else if (event.key === 'ArrowUp') focus(index - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(items.length - 1);
    else if (event.key === 'Escape') {
      setOpen(false);
      buttonRef.current?.focus();
    } else return;
    event.preventDefault();
  };

  let lastGroup = '';
  return (
    <div className="menu-wrap">
      <button
        ref={buttonRef}
        className="icon-button"
        aria-label={label}
        title={title}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`${testId}-button`}
        onClick={() => setOpen((v) => !v)}
      >
        {glyph}
      </button>
      {open && (
        <div
          ref={menuRef}
          className={compact ? 'menu compact' : 'menu'}
          role="menu"
          aria-label={label}
          data-testid={testId}
          onKeyDown={onMenuKey}
        >
          {commands.map((command) => {
            const separator = lastGroup !== '' && lastGroup !== command.group;
            lastGroup = command.group;
            return (
              <button
                key={command.id}
                role="menuitem"
                className={separator ? 'separated' : ''}
                tabIndex={-1}
                onClick={() => {
                  setOpen(false);
                  runCommand(command);
                }}
              >
                <CommandLabel command={command} />
                {command.shortcut && <kbd>{command.shortcut}</kbd>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function CommandMenu() {
  return (
    <ButtonMenu
      glyph="≡"
      label={S.menu}
      title={S.menuTitle(paletteShortcut)}
      testId="menu"
      listCommands={buildCommands}
    />
  );
}

export function StartMenu() {
  return (
    <ButtonMenu
      glyph="+"
      label={S.openOrCreate}
      title={S.openOrCreate}
      testId="start-menu"
      compact
      listCommands={startCommands}
    />
  );
}

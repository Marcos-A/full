import { useEffect, useMemo, useRef, useState } from 'react';
import { fuzzyScore } from '../core/fuzzy';
import { ws } from '../doc/workspace';
import { S } from '../strings';
import { buildCommands, Command, paletteShortcut, runCommand } from './commands';

function CommandLabel({ command }: { command: Command }) {
  return (
    <span className="command-label">
      {command.swatch && <i className="swatch" data-accent={command.swatch} />}
      {command.label}
    </span>
  );
}

export function CommandPalette({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const commands = useMemo(() => buildCommands(), []);

  const matches = useMemo(() => {
    if (!query.trim()) return commands;
    return commands
      .map((command) => ({ command, score: fuzzyScore(query, command.label) }))
      .filter((m): m is { command: Command; score: number } => m.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((m) => m.command);
  }, [commands, query]);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const close = (focus: boolean) => {
    ws.paletteQuery = null;
    ws.bump();
    if (focus) requestAnimationFrame(() => ws.active?.focus());
  };
  const run = (command: Command | undefined) => {
    if (!command) return;
    close(true);
    runCommand(command);
  };

  return (
    <dialog
      ref={dialogRef}
      className="palette"
      data-testid="palette"
      aria-label={S.menu}
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
        aria-activedescendant={matches[selected] ? `palette-${matches[selected].id}` : undefined}
        aria-label={S.commandPlaceholder}
        placeholder={S.commandPlaceholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setSelected((s) => Math.min(s + 1, matches.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setSelected((s) => Math.max(s - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            run(matches[selected]);
          }
        }}
      />
      <ul id="palette-list" role="listbox" ref={listRef} className="palette-list">
        {matches.map((command, index) => (
          <li
            key={command.id}
            id={`palette-${command.id}`}
            role="option"
            aria-selected={index === selected}
            className={index === selected ? 'selected' : ''}
            onMouseMove={() => setSelected(index)}
            onClick={() => run(command)}
          >
            <CommandLabel command={command} />
            {command.shortcut && <kbd>{command.shortcut}</kbd>}
          </li>
        ))}
        {matches.length === 0 && <li className="palette-none">{S.noCommands}</li>}
      </ul>
    </dialog>
  );
}

export function CommandMenu() {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const commands = open ? buildCommands() : [];

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
        aria-label={S.menu}
        title={S.menuTitle(paletteShortcut)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="menu-button"
        onClick={() => setOpen((v) => !v)}
      >
        ≡
      </button>
      {open && (
        <div ref={menuRef} className="menu" role="menu" aria-label={S.menu} data-testid="menu" onKeyDown={onMenuKey}>
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

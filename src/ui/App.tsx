import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { APP_NAME } from '../config';
import { OpenDoc } from '../doc/OpenDoc';
import { ws } from '../doc/workspace';
import { language, S } from '../strings';
import { FORMAT_ACTIONS, FormatAction, formatActionForKey, formatShortcut } from '../doc/markdownFormat';
import { host } from '../platform/host';
import { buildCommands, paletteShortcut, runCommand, startCommandForKey, viewCommandForKey, zoomStepForKey } from './commands';
import { CommandMenu, CommandPalette, StartMenu } from './CommandUi';
import { CsvView } from './CsvView';
import { DialogHost } from './DialogHost';
import { Logo } from './Logo';
import { HtmlPane } from './HtmlPane';
import { MarkdownPane, SplitView } from './MarkdownPane';
import { RecoveryDialog, RecoveryList } from './Recovery';
import { StatusBar } from './StatusBar';

function useGlobalKeys(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const modKey = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (modKey && !event.altKey && key === 'k') {
        event.preventDefault();
        ws.paletteQuery = ws.paletteQuery === null ? '' : null;
        ws.bump();
        return;
      }
      // Alt+K ("keys") opens the shortcut list, or closes the palette. By key position, as Option+K
      // types a symbol on a Mac. Not Cmd+?: Safari, Edge and the Mac app's Help menu take that.
      if (event.altKey && !modKey && !event.shiftKey && event.code === 'KeyK') {
        event.preventDefault();
        event.stopPropagation();
        ws.paletteQuery = ws.paletteQuery === null ? '?' : null;
        ws.bump();
        return;
      }
      // Here rather than only in the menu: see zoomStepForKey. Only where the app has its own zoom,
      // so a browser keeps its zoom keys.
      const zoom = host().setZoom ? zoomStepForKey(event) : undefined;
      if (zoom !== undefined) {
        event.preventDefault();
        event.stopPropagation();
        if (zoom === 0) ws.applyZoom(1);
        else ws.stepZoom(zoom);
        return;
      }
      if (ws.dialog || ws.paletteQuery !== null || ws.recoveryDialogOpen) return;
      const startCommand = startCommandForKey(event);
      if (startCommand) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) runCommand(startCommand);
        return;
      }
      // Printing only ever shows the file, never the interface (see print.ts).
      if (modKey && !event.altKey && !event.shiftKey && key === 'p' && host().canPrint) {
        event.preventDefault();
        event.stopPropagation();
        const print = buildCommands().find((command) => command.id === 'export-pdf');
        if (print && !event.repeat) runCommand(print);
        return;
      }
      const doc = ws.active;
      if (!doc) return;
      if (modKey && !event.altKey && key === 's') {
        event.preventDefault();
        void ws.save(doc, { as: event.shiftKey });
        return;
      }
      // event.code: on macOS, Option+W produces "∑" as the key.
      if (event.altKey && !modKey && event.code === 'KeyW') {
        event.preventDefault();
        void ws.closeDoc(doc);
        return;
      }
      const viewCommand = viewCommandForKey(event);
      if (viewCommand) {
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        const hadFocus = document.activeElement?.closest?.('.document') !== null;
        runCommand(viewCommand);
        // The side that had the focus may have just been hidden.
        if (hadFocus) requestAnimationFrame(() => doc.focus());
        return;
      }
      // event.code: on macOS, Option+B produces "∫". Elsewhere than Markdown it stays a typing key.
      if (event.altKey && !modKey && !event.shiftKey && event.code === 'KeyB' && doc.kind === 'markdown') {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) ws.toggleFormatBar();
        return;
      }
      // By key position, as Option+S produces "ß". Alt+S has no use in a table, so it stays a typing key there.
      if (event.altKey && !modKey && !event.shiftKey && event.code === 'KeyS' && doc.source) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) doc.toggleSplitEditor();
        return;
      }
      // By key position too: Option+L produces "¬". In a table, where there are none, it stays a typing key.
      if (event.altKey && !modKey && !event.shiftKey && event.code === 'KeyL' && doc.source) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) ws.toggleLineNumbers();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.grid-editor, input, .cm-panels')) return;
      const format = doc.kind === 'markdown' ? formatActionForKey(event) : undefined;
      if (format) {
        event.preventDefault();
        event.stopPropagation();
        if (!event.repeat) ws.format(format);
        return;
      }
      if (modKey && !event.altKey && (key === 'z' || key === 'y')) {
        event.preventDefault();
        event.stopPropagation();
        if (key === 'y' || event.shiftKey) doc.redo();
        else doc.undo();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

function useDropZone(): boolean {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    const over = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const enter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current++;
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    // Capture phase: a file dropped on an editor opens as a tab instead of inserting into the text.
    const drop = (event: DragEvent) => {
      if (!hasFiles(event) || !event.dataTransfer) return;
      event.preventDefault();
      event.stopPropagation();
      depth.current = 0;
      setDragging(false);
      ws.dropped(event.dataTransfer);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop, true);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop, true);
    };
  }, []);
  return dragging;
}

const outsideWindow = (event: PointerEvent) =>
  event.clientX < 0 || event.clientY < 0 || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight;

/**
 * Dragging a tab out of the window moves its file to a new window, where the app has windows. It
 * only counts as a drag once the pointer has moved a little, so a click stays a click.
 */
function startTabDrag(event: React.PointerEvent<HTMLElement>, doc: OpenDoc): void {
  if (event.button !== 0 || !ws.canMoveToNewWindow()) return;
  const tab = event.currentTarget;
  const { clientX: startX, clientY: startY, pointerId } = event;
  let dragging = false;
  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < 8) return;
      dragging = true;
      // From here the pointer is followed outside the window too.
      tab.setPointerCapture(pointerId);
      tab.classList.add('dragging');
    }
    tab.classList.toggle('outside', outsideWindow(e));
  };
  const end = (e: PointerEvent) => {
    if (e.pointerId !== pointerId) return;
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    tab.classList.remove('dragging', 'outside');
    if (!dragging) return;
    // The release isn't a click on whatever it ended over.
    const swallow = (click: MouseEvent) => click.stopPropagation();
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
    if (e.type === 'pointerup' && outsideWindow(e)) void ws.moveToNewWindow(doc, { x: e.screenX, y: e.screenY });
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
}

function Tabs() {
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight') ws.cycleTab(1);
    if (event.key === 'ArrowLeft') ws.cycleTab(-1);
  };
  return (
    <div className="tabbar">
      <div className="tabs" role="group" aria-label={S.openFiles} onKeyDown={onKeyDown}>
        {ws.tabStrip().map((entry) => {
          // A tab from the last session whose file hasn't been read yet looks the same, and loads when clicked.
          const doc = entry instanceof OpenDoc ? entry : null;
          const active = entry.id === ws.activeId;
          const dirty = doc ? doc.dirty || doc.fileMissing : entry.dirty;
          return (
            <div
              key={entry.id}
              className={`tab${active ? ' active' : ''}`}
              data-testid="tab"
              onPointerDown={doc ? (event) => startTabDrag(event, doc) : undefined}
            >
              <button
                className="tab-name"
                aria-current={active ? 'true' : undefined}
                title={entry.name}
                onClick={() => (doc ? ws.activate(doc.id) : void ws.showPending(entry.id))}
              >
                {dirty && (
                  <span className="dirty-dot" data-testid="dirty">
                    <span className="sr-only">{S.unsaved}: </span>
                  </span>
                )}
                {entry.name}
              </button>
              <button
                className="tab-close"
                aria-label={S.closeTab(entry.name)}
                onClick={() => void (doc ? ws.closeDoc(doc) : ws.closePending(entry.id))}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <StartMenu />
      <CommandMenu />
    </div>
  );
}

let formatBar: Promise<import('./formatBar').FormatBar> | null = null;

/** The bar is built once, on first show, and kept for every Markdown tab after that. */
function FormatBarHost() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let cancelled = false;
    formatBar ??= import('./formatBar').then(({ createFormatBar }) =>
      createFormatBar(
        (action) => ws.format(action as FormatAction),
        () => ws.active?.focus(),
      ),
    );
    void formatBar.then((bar) => {
      if (cancelled || !ref.current) return;
      bar.localize(
        S.formatBar,
        FORMAT_ACTIONS.map((action) => ({ action, label: S.formatNames[action], shortcut: formatShortcut(action) })),
      );
      ref.current.append(bar.element);
    });
    return () => {
      cancelled = true;
    };
  }, [language]);
  return <div className="format-bar-host" ref={ref} />;
}

function Notices() {
  return (
    <div className="notices" role="status" aria-live="polite">
      {ws.notices.map((notice) => (
        <div key={notice.id} className={`notice ${notice.kind}`} data-testid={`notice-${notice.kind}`}>
          <span>{notice.text}</span>
          <button className="link-button" aria-label={S.dismiss} onClick={() => ws.dismissNotice(notice.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function Banners() {
  const showRecovery = ws.docs.length > 0 && ws.recovery.length > 0 && !ws.recoveryBannerDismissed;
  return (
    <>
      {ws.storageProblem && (
        <div className="banner warning" role="alert" data-testid="storage-warning">
          {S.storageWarning}
        </div>
      )}
      {ws.browserNotice && (
        <div className="banner" data-testid="browser-notice">
          <span>{S.browserLimit}</span>
          <button className="link-button" onClick={() => ws.dismissBrowserNotice()}>
            {S.dismiss}
          </button>
        </div>
      )}
      {showRecovery && (
        <div className="banner" data-testid="recovery-banner">
          <span>{S.recoveryBanner(ws.recovery.length)}</span>
          <span className="banner-actions">
            <button
              className="link-button"
              onClick={() => {
                ws.recoveryDialogOpen = true;
                ws.bump();
              }}
            >
              {S.recoveryReview}
            </button>
            <button
              className="link-button"
              onClick={() => {
                ws.recoveryBannerDismissed = true;
                ws.bump();
              }}
            >
              {S.dismiss}
            </button>
          </span>
        </div>
      )}
    </>
  );
}

function EmptyState() {
  return (
    <main className="empty" data-testid="empty">
      <div className="empty-inner">
        <h1 className="empty-logo">
          <span className="sr-only">{APP_NAME}</span>
          <Logo />
        </h1>
        {S.nameMeaning.length > 0 && (
          <p className="empty-caption" data-testid="name-meaning">
            {S.nameMeaning.map((part, i) => (i % 2 ? <em key={i}>{part}</em> : part))}
          </p>
        )}
        <div className="empty-actions">
          <button className="button primary" onClick={() => void ws.openPicked()}>
            {S.openFile}
          </button>
          <button className="button" onClick={() => void ws.newFile()}>
            {S.newFile}
          </button>
        </div>
        <p className="empty-drop">{S.dropHint}</p>
        <p className="empty-footnote">
          <span>{S.privacyHint}</span>
          <span className="commands-hint" data-testid="commands-hint">{S.commandsHint(paletteShortcut)}</span>
        </p>
        {ws.recovery.length > 0 && <RecoveryList />}
      </div>
    </main>
  );
}

export function App() {
  useSyncExternalStore(ws.subscribe, ws.getVersion);
  useGlobalKeys();
  const dragging = useDropZone();

  return (
    <div className="app">
      {ws.tabStrip().length > 0 && <Tabs />}
      <Banners />
      {ws.formatBar && ws.active?.kind === 'markdown' && <FormatBarHost />}
      {ws.restoring ? (
        <main className="documents" />
      ) : ws.docs.length === 0 && ws.pending.length === 0 ? (
        <EmptyState />
      ) : (
        <main className="documents">
          {ws.docs.map((doc) => (
            <div key={doc.id} className="document" hidden={doc.id !== ws.activeId} data-testid="document">
              {doc.kind === 'markdown' && <MarkdownPane doc={doc} />}
              {doc.kind === 'text' && (doc.isHtml ? <HtmlPane doc={doc} /> : <SplitView doc={doc} />)}
              {doc.kind === 'csv' && <CsvView doc={doc} />}
            </div>
          ))}
        </main>
      )}
      <StatusBar />
      <Notices />
      {dragging && (
        <div className="drop-overlay" data-testid="drop-overlay">
          {S.dropOverlay}
        </div>
      )}
      {ws.paletteQuery !== null && <CommandPalette initialQuery={ws.paletteQuery} />}
      {ws.recoveryDialogOpen && <RecoveryDialog />}
      <DialogHost />
    </div>
  );
}

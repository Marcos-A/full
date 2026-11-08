import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { APP_NAME } from '../config';
import { ws } from '../doc/workspace';
import { S } from '../strings';
import { paletteShortcut } from './commands';
import { CommandMenu, CommandPalette, StartMenu } from './CommandUi';
import { CsvView } from './CsvView';
import { DialogHost } from './DialogHost';
import { Logo } from './Logo';
import { MarkdownPane, SourceHost } from './MarkdownPane';
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
      if (ws.dialog || ws.paletteQuery !== null || ws.recoveryDialogOpen) return;
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
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('.grid-editor, input, .cm-panels')) return;
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

function Tabs() {
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowRight') ws.cycleTab(1);
    if (event.key === 'ArrowLeft') ws.cycleTab(-1);
  };
  return (
    <div className="tabbar">
      <div className="tabs" role="group" aria-label={S.openFiles} onKeyDown={onKeyDown}>
        {ws.docs.map((doc) => {
          const active = doc.id === ws.activeId;
          return (
            <div key={doc.id} className={`tab${active ? ' active' : ''}`} data-testid="tab">
              <button
                className="tab-name"
                aria-current={active ? 'true' : undefined}
                title={doc.name}
                onClick={() => ws.activate(doc.id)}
              >
                {doc.dirty && (
                  <span className="dirty-dot" data-testid="dirty">
                    <span className="sr-only">{S.unsaved}: </span>
                  </span>
                )}
                {doc.name}
              </button>
              <button className="tab-close" aria-label={S.closeTab(doc.name)} onClick={() => void ws.closeDoc(doc)}>
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
      {ws.docs.length > 0 && <Tabs />}
      <Banners />
      {ws.docs.length === 0 ? (
        <EmptyState />
      ) : (
        <main className="documents">
          {ws.docs.map((doc) => (
            <div key={doc.id} className="document" hidden={doc.id !== ws.activeId} data-testid="document">
              {doc.kind === 'markdown' && <MarkdownPane doc={doc} />}
              {doc.kind === 'text' && <SourceHost pane={doc.source!} />}
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

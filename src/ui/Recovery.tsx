import { useEffect, useRef } from 'react';
import { RecoveryEntry, ws } from '../doc/workspace';
import { S } from '../strings';

const oneDecimal = (value: number): string =>
  value.toLocaleString(S.numberLocale, { minimumFractionDigits: 1, maximumFractionDigits: 1, useGrouping: false });

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${oneDecimal(bytes / 1024)} KB`;
  return `${oneDecimal(bytes / (1024 * 1024))} MB`;
}

function formatWhen(time: number): string {
  return new Date(time).toLocaleString(S.dateLocale, { dateStyle: 'medium', timeStyle: 'short' });
}

function Entry({ entry }: { entry: RecoveryEntry }) {
  return (
    <li className="recovery-entry" data-testid="recovery-entry">
      <div className="recovery-info">
        <span className="recovery-name">{entry.name}</span>
        <span className="muted">
          {S.kindNames[entry.kind]} · {S.edited(formatWhen(entry.updatedAt))} · {formatSize(entry.fileSize)} ·{' '}
          {entry.hasUnsavedChanges ? S.hasUnsaved : S.noUnsaved}
        </span>
      </div>
      <div className="recovery-actions">
        <button className="button" onClick={() => void ws.restore(entry.id)}>
          {S.restore}
        </button>
        <button className="button" onClick={() => void ws.downloadCopy(entry.id)}>
          {S.downloadCopy}
        </button>
        <button className="button" onClick={() => void ws.discard(entry.id)}>
          {S.discard}
        </button>
      </div>
    </li>
  );
}

export function RecoveryList() {
  return (
    <section className="recovery" data-testid="recovery-list" aria-label={S.recoveryHeading}>
      <div className="recovery-head">
        <h2>{S.recoveryHeading}</h2>
        <div className="recovery-actions">
          <button className="button" onClick={() => void ws.restoreAll()}>
            {S.restoreAll}
          </button>
          <button className="button" onClick={() => void ws.clearAllRecovery()}>
            {S.clearAll}
          </button>
        </div>
      </div>
      <p className="muted recovery-note">{S.recoveryNote}</p>
      {ws.recovery.length === 0 ? (
        <p className="muted">{S.recoveryEmpty}</p>
      ) : (
        <ul>
          {ws.recovery.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function RecoveryDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  const close = () => {
    ws.recoveryDialogOpen = false;
    ws.bump();
  };
  return (
    <dialog
      ref={ref}
      className="dialog wide"
      data-testid="recovery-dialog"
      aria-label={S.recoveryHeading}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <RecoveryList />
      <div className="dialog-actions">
        <button className="button" onClick={close}>
          {S.close}
        </button>
      </div>
    </dialog>
  );
}

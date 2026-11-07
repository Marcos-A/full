import { useEffect, useRef, useState } from 'react';
import { DialogRequest, ws } from '../doc/workspace';

function Dialog({ request }: { request: DialogRequest }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [checked, setChecked] = useState(false);
  const [value, setValue] = useState(request.input?.value ?? '');

  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => dialog.close();
  }, []);

  const finish = (action: string) => ws.finishDialog({ action, checked, value });

  return (
    <dialog
      ref={ref}
      className="dialog"
      data-testid="dialog"
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        finish(request.cancelId);
      }}
    >
      <h2 id="dialog-title">{request.title}</h2>
      {request.body && <p>{request.body}</p>}
      {request.input && (
        <label className="dialog-field">
          {request.input.label}
          <input
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                finish(request.actions.find((a) => a.primary)?.id ?? request.cancelId);
              }
            }}
          />
        </label>
      )}
      {request.checkbox && (
        <label className="dialog-check">
          <input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} />
          {request.checkbox}
        </label>
      )}
      <div className="dialog-actions">
        {request.actions.map((action) => (
          <button
            key={action.id}
            className={`button${action.primary ? ' primary' : ''}${action.danger ? ' danger' : ''}`}
            autoFocus={action.primary}
            onClick={() => finish(action.id)}
          >
            {action.label}
          </button>
        ))}
      </div>
    </dialog>
  );
}

export function DialogHost() {
  if (!ws.dialog) return null;
  // A new key per request, so that each one starts with fresh state and opens as a modal.
  return <Dialog key={ws.dialog.title + ws.dialog.body} request={ws.dialog} />;
}

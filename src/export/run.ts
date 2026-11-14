import type { OpenDoc } from '../doc/OpenDoc';
import { host } from '../platform/host';
import { S } from '../strings';
import { exportName } from './names';
import type { XlsxInput, XlsxLimit } from './xlsx';

/**
 * Writes a copy of the open file in another format. The original is never touched and the tab
 * stays as it is: no markSaved, and no change to its binding, name, type or dirty mark.
 */

export type ExportFormat = 'html' | 'xlsx' | 'pdf';
type Notify = (kind: 'info' | 'error', text: string) => void;

class LimitReached extends Error {
  constructor(readonly detail: XlsxLimit) {
    super(detail.limit);
  }
}

/** On a worker, as CSV parsing is, and here only if the worker can't start. */
function xlsxBytes(input: XlsxInput): Promise<Uint8Array> {
  const inline = () =>
    import('./xlsx').then(({ buildXlsx, XlsxLimitError }) =>
      buildXlsx(input).catch((error: unknown) => {
        throw error instanceof XlsxLimitError ? new LimitReached(error.detail) : error;
      }),
    );
  if (typeof Worker === 'undefined') return inline();
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./xlsxWorker.ts', import.meta.url), { type: 'module' });
    } catch {
      inline().then(resolve, reject);
      return;
    }
    worker.onmessage = (event: MessageEvent<{ bytes?: Uint8Array; limit?: XlsxLimit; error?: string }>) => {
      worker.terminate();
      const { bytes, limit, error } = event.data;
      if (bytes) resolve(bytes);
      else if (limit) reject(new LimitReached(limit));
      else reject(new Error(error ?? 'XLSX export failed'));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      worker.terminate();
      inline().then(resolve, reject);
    };
    worker.postMessage(input);
  });
}

function limitMessage(detail: XlsxLimit): string {
  if (detail.limit === 'rows') return S.xlsxTooManyRows;
  if (detail.limit === 'columns') return S.xlsxTooManyColumns;
  return S.xlsxCellTooLong(detail.cell);
}

/** Anything typed so far, including a grid cell still being edited, as Save does. */
function flush(doc: OpenDoc): void {
  const active = document.activeElement as HTMLElement | null;
  if (active?.closest?.('.grid-editor')) active.blur();
  doc.flushEditors();
}

/**
 * Where the browser has a save picker, the user picks a place and a name. Elsewhere this is a
 * download, and in the Mac app the save panel. Resolves to the name written, or null if cancelled.
 */
async function writeCopy(name: string, bytes: Uint8Array): Promise<string | null> {
  const webPicker = host().canDownload && host().canOverwrite;
  if (!webPicker) return (await host().exportCopy(name, bytes)) ? name : null;
  const target = await host().pickSaveTarget(name);
  if (!target) return null;
  try {
    await host().write(target.binding, bytes);
  } catch (error) {
    await host().forgetSaveTarget?.(target.binding);
    throw error;
  }
  return target.name;
}

/** `notify` is the workspace's: this module doesn't import the workspace, so it stays out of the main bundle's way. */
export async function runExport(doc: OpenDoc, format: ExportFormat, notify: Notify): Promise<void> {
  flush(doc);
  try {
    if (format === 'pdf') {
      const { printDoc } = await import('./print');
      await printDoc(doc);
      return;
    }
    let bytes: Uint8Array;
    if (format === 'html') {
      const { markdownToHtml } = await import('./html');
      bytes = new TextEncoder().encode((await markdownToHtml(doc.markdownBody(), doc.name)).page);
    } else {
      const csv = doc.csv!;
      bytes = await xlsxBytes({
        text: doc.currentText(),
        delimiter: csv.delimiter,
        headerRow: doc.headerRow,
        columnWidths: csv.columnWidths.slice(),
        fileName: doc.name,
        localeDecimal: (1.5).toLocaleString().includes(',') ? ',' : '.',
      });
    }
    const written = await writeCopy(exportName(doc.name, format), bytes);
    if (written) notify('info', S.exported(written));
  } catch (error) {
    if (error instanceof LimitReached) {
      notify('error', limitMessage(error.detail));
      return;
    }
    console.error(error);
    notify('error', S.exportFailed(error instanceof Error ? error.message : String(error)));
  }
}

import { SUPPORTED_EXTENSIONS } from '../core/fileTypes';

export const canOverwriteFiles = (): boolean => 'showSaveFilePicker' in window;

const PICKER_TYPES: FilePickerAcceptType[] = [
  {
    description: 'CSV, Markdown and text files',
    accept: { 'text/plain': SUPPORTED_EXTENSIONS as `.${string}`[] },
  },
];

export interface PickedFile {
  file: File;
  handle?: FileSystemFileHandle;
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

export async function pickFiles(): Promise<PickedFile[]> {
  if ('showOpenFilePicker' in window) {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true, types: PICKER_TYPES });
      return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })));
    } catch (error) {
      if (isAbort(error)) return [];
      throw error;
    }
  }
  return pickWithInput();
}

/** One long-lived input: browsers may drop events from one that's detached straight after use. */
let fileInput: HTMLInputElement | null = null;
let settleInput: ((files: PickedFile[]) => void) | null = null;

function pickWithInput(): Promise<PickedFile[]> {
  if (!fileInput) {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = SUPPORTED_EXTENSIONS.join(',');
    input.className = 'sr-only';
    input.tabIndex = -1;
    input.setAttribute('aria-hidden', 'true');
    input.addEventListener('change', () => {
      const files = Array.from(input.files ?? []).map((file) => ({ file }));
      settleInput?.(files);
      settleInput = null;
      input.value = '';
    });
    document.body.append(input);
    fileInput = input;
  }
  return new Promise((resolve) => {
    settleInput?.([]);
    settleInput = resolve;
    fileInput!.click();
  });
}

/**
 * Handles must be requested during the drop event itself, so this runs synchronously up to the
 * first await and collects the promises first.
 */
export function filesFromDrop(data: DataTransfer): Promise<PickedFile[]> {
  const pending: Promise<PickedFile | null>[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    const handlePromise = item.getAsFileSystemHandle?.();
    pending.push(
      (async () => {
        const handle = await handlePromise?.catch(() => null);
        if (handle && handle.kind === 'file') {
          const fileHandle = handle as FileSystemFileHandle;
          return { file: file ?? (await fileHandle.getFile()), handle: fileHandle };
        }
        return file ? { file } : null;
      })(),
    );
  }
  return Promise.all(pending).then((all) => all.filter((f): f is PickedFile => f !== null));
}

export async function pickSaveHandle(suggestedName: string): Promise<FileSystemFileHandle | null> {
  try {
    return await window.showSaveFilePicker({ suggestedName, types: PICKER_TYPES });
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/**
 * 'prompt' means nothing was decided. The browser asks for read access first, and if the user
 * took a few seconds over that, the click that started this has expired, so the write request
 * can't show its prompt. It needs a fresh click, which isn't the same as being refused.
 */
export async function requestWritePermission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const descriptor = { mode: 'readwrite' as const };
  if ((await handle.queryPermission?.(descriptor)) === 'granted') return 'granted';
  if (!handle.requestPermission) return 'granted';
  return handle.requestPermission(descriptor);
}

export async function writeToHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<number> {
  const writable = await handle.createWritable();
  await writable.write(bytes as unknown as FileSystemWriteChunkType);
  await writable.close();
  return (await handle.getFile()).lastModified;
}

export function downloadBytes(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function writeClipboard(html: string | null, plain: string): Promise<void> {
  if (html !== null && 'ClipboardItem' in window && navigator.clipboard?.write) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([plain], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(plain);
}

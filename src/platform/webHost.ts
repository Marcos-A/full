import { kindFromName, SUPPORTED_EXTENSIONS } from '../core/fileTypes';
import { S } from '../strings';
import { FileMissingError, type FileBinding, type FileHost, type PickedFile } from './host';

/** For saving only. Opening shows every file, as any of them may be text. */
const pickerTypes = (): FilePickerAcceptType[] => [
  {
    description: S.pickerDescription,
    accept: { 'text/plain': SUPPORTED_EXTENSIONS as `.${string}`[] },
  },
];

const webBinding = (handle: FileSystemFileHandle): FileBinding => ({ kind: 'web', handle });

function handleOf(binding: FileBinding): FileSystemFileHandle {
  if (binding.kind !== 'web') throw new Error('The browser was given a native path');
  return binding.handle;
}

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

async function pickFiles(): Promise<PickedFile[]> {
  if ('showOpenFilePicker' in window) {
    try {
      const handles = await window.showOpenFilePicker({ multiple: true });
      return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), binding: webBinding(handle) })));
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
function filesFromDrop(data: DataTransfer): Promise<PickedFile[]> {
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
          return { file: file ?? (await fileHandle.getFile()), binding: webBinding(fileHandle) };
        }
        return file ? { file } : null;
      })(),
    );
  }
  return Promise.all(pending).then((all) => all.filter((f): f is PickedFile => f !== null));
}

async function pickSaveTarget(suggestedName: string) {
  try {
    // With a filter, some systems add its first extension to a name that has none.
    const types = kindFromName(suggestedName) ? pickerTypes() : undefined;
    const handle = await window.showSaveFilePicker({ suggestedName, types });
    return { binding: webBinding(handle), name: handle.name };
  } catch (error) {
    if (isAbort(error)) return null;
    throw error;
  }
}

/** The browser creates the file when its picker closes, so backing out would leave an empty one. */
async function forgetSaveTarget(binding: FileBinding): Promise<void> {
  if (binding.kind !== 'web') return;
  // Chromium has remove(), which the type definitions don't list yet.
  const handle: FileSystemFileHandle & { remove?: () => Promise<void> } = binding.handle;
  if ((await handle.getFile()).size === 0) await handle.remove?.();
}

/**
 * 'prompt' means nothing was decided. The browser asks for read access first, and if the user
 * took a few seconds over that, the click that started this has expired, so the write request
 * can't show its prompt. It needs a fresh click, which isn't the same as being refused.
 */
async function requestWritePermission(handle: FileSystemFileHandle): Promise<PermissionState> {
  const descriptor = { mode: 'readwrite' as const };
  if ((await handle.queryPermission?.(descriptor)) === 'granted') return 'granted';
  if (!handle.requestPermission) return 'granted';
  return handle.requestPermission(descriptor);
}

/** Only a real absence counts. A permission that has lapsed says nothing about the file. */
function reportMissing(error: unknown): never {
  if (error instanceof DOMException && error.name === 'NotFoundError') throw new FileMissingError(error.message);
  throw error;
}

async function statHandle(handle: FileSystemFileHandle) {
  const file = await handle.getFile().catch(reportMissing);
  return { size: file.size, modifiedMs: file.lastModified };
}

async function writeToHandle(handle: FileSystemFileHandle, bytes: Uint8Array) {
  const writable = await handle.createWritable().catch(reportMissing);
  await writable.write(bytes as unknown as FileSystemWriteChunkType);
  await writable.close();
  return statHandle(handle);
}

function downloadBytes(name: string, bytes: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export const webHost: FileHost = {
  // Read each time: the tests remove the pickers to act as a browser that lacks them.
  get canOverwrite() {
    return 'showSaveFilePicker' in window;
  },
  canDownload: true,
  opensAnyType: true,
  pickFiles,
  filesFromDrop,
  pickSaveTarget,
  forgetSaveTarget,
  ensureWritable: (binding) => requestWritePermission(handleOf(binding)),
  stat: (binding) => statHandle(handleOf(binding)),
  write: (binding, bytes) => writeToHandle(handleOf(binding), bytes),
  isSame: (a, b) => handleOf(a).isSameEntry(handleOf(b)),
  exportCopy: async (name, bytes) => {
    downloadBytes(name, bytes);
    return true;
  },
  canPrint: true,
  openExternal: (href) => void window.open(href, '_blank', 'noopener,noreferrer'),
};

import { webHost } from './webHost';

/**
 * Where an open file lives. Plain data, so the app never needs to know how a platform reaches it.
 * A native `path` only identifies the file, and native code never accepts it back: `grant` is what
 * reaches it. A file restored from a recovery record has no grant yet, only a `ticket`, with which
 * native code can ask the user about the file it remembers.
 */
export type FileBinding =
  | { kind: 'web'; handle: FileSystemFileHandle }
  | { kind: 'native'; path: string; grant?: string; ticket?: string };

export interface Revision {
  size: number;
  modifiedMs: number;
}

/** The parts of a File that opening needs. A real File already fits. */
export type FileLike = Pick<File, 'name' | 'size' | 'lastModified' | 'arrayBuffer'>;

export interface PickedFile {
  file: FileLike;
  binding?: FileBinding;
}

/** The file isn't the one the write was told to expect, so nothing was written. */
export class FileChangedError extends Error {}

/** Nothing is at the file's location. Any other failure says nothing about whether it exists. */
export class FileMissingError extends Error {}

/** The user said no to a native confirmation. Nothing failed, so nothing is reported. */
export class SaveCancelled extends Error {}

/** Everything the app needs from the platform to reach files outside itself. */
export interface FileHost {
  /** Save can replace the original. Otherwise saving makes a copy with exportCopy. */
  readonly canOverwrite: boolean;
  /** exportCopy hands the bytes to the browser as a download, so offer it by that name. */
  readonly canDownload: boolean;
  /** The most time steady typing can go without reaching the recovery store. Unset, it's unlimited. */
  readonly persistMaxWaitMs?: number;
  /** A file of any other type opens as plain text. Otherwise only the supported types open. */
  readonly opensAnyType: boolean;
  /** Cmd/Ctrl+N gets to the page. A browser keeps it for opening a new window. */
  readonly newKeyReachesPage?: boolean;
  /** Resolves to nothing if the user cancels. */
  pickFiles(): Promise<PickedFile[]>;
  filesFromDrop(data: DataTransfer): Promise<PickedFile[]>;
  /** Resolves to null if the user cancels. */
  pickSaveTarget(suggestedName: string): Promise<{ binding: FileBinding; name: string } | null>;
  /** Clears up after a target that was picked and then not used. */
  forgetSaveTarget?(binding: FileBinding): Promise<void>;
  /** 'prompt' means nothing was decided, and asking again needs a fresh click. */
  ensureWritable(binding: FileBinding): Promise<PermissionState>;
  /** Rejects if the file can't be reached, with FileMissingError if it no longer exists. */
  stat(binding: FileBinding): Promise<Revision>;
  /**
   * Resolves only once the bytes are in place, with the revision that resulted. A host that can
   * check `expected` rejects with FileChangedError if the file no longer matches it. The browser's
   * can't, so there the check before this call is the only one. 'missing' puts back a file that
   * was deleted, and rejects with FileMissingError if that can't be done, as when its folder went too.
   */
  write(binding: FileBinding, bytes: Uint8Array, expected?: Revision | 'missing'): Promise<Revision>;
  /** Where this exists, a conflict can offer Reload. The revision is from before the bytes were read. */
  reread?(binding: FileBinding): Promise<{ bytes: ArrayBuffer; revision: Revision }>;
  isSame(a: FileBinding, b: FileBinding): Promise<boolean>;
  /** Puts a copy somewhere of the user's choosing. The open file stays bound where it was. False if the user cancelled. */
  exportCopy(name: string, bytes: Uint8Array): Promise<boolean>;
  /** The system print dialog works here, and with it "Save as PDF". WKWebView's window.print() does nothing. */
  readonly canPrint?: boolean;
  openExternal(href: string): void;
  /** Where this exists, the app has its own zoom. A browser has its own, so the website leaves it out. */
  setZoom?(level: number): void;
}

let current: FileHost = webHost;

/** Read this when it's needed: a desktop entry point replaces it before the app starts. */
export const host = (): FileHost => current;

export function setHost(next: FileHost): void {
  current = next;
}

/** How a binding is stored in a recovery record. Older records only ever have `handle`. */
export interface StoredBinding {
  handle?: FileSystemFileHandle;
  nativePath?: string;
  nativeTicket?: string;
}

export function storedBinding(binding: FileBinding | undefined): StoredBinding {
  if (binding?.kind === 'web') return { handle: binding.handle };
  if (binding?.kind === 'native') return { nativePath: binding.path, nativeTicket: binding.ticket };
  return {};
}

export function bindingFromStored(stored: StoredBinding): FileBinding | undefined {
  if (stored.handle) return { kind: 'web', handle: stored.handle };
  if (stored.nativePath) return { kind: 'native', path: stored.nativePath, ticket: stored.nativeTicket };
  return undefined;
}

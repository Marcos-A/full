import { webHost } from './webHost';

/**
 * Where an open file lives. Plain data, so the app never needs to know how a platform reaches it.
 * A native `path` only identifies the file, and native code never accepts it back: `grant` is what
 * reaches it. A file restored from a recovery record has no grant yet.
 */
export type FileBinding =
  | { kind: 'web'; handle: FileSystemFileHandle }
  | { kind: 'native'; path: string; grant?: string };

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

/** Everything the app needs from the platform to reach files outside itself. */
export interface FileHost {
  /** Save can replace the original. Otherwise saving makes a copy with exportCopy. */
  readonly canOverwrite: boolean;
  /** exportCopy hands the bytes to the browser as a download, so offer it by that name. */
  readonly canDownload: boolean;
  /** Resolves to nothing if the user cancels. */
  pickFiles(): Promise<PickedFile[]>;
  filesFromDrop(data: DataTransfer): Promise<PickedFile[]>;
  /** Resolves to null if the user cancels. */
  pickSaveTarget(suggestedName: string): Promise<{ binding: FileBinding; name: string } | null>;
  /** 'prompt' means nothing was decided, and asking again needs a fresh click. */
  ensureWritable(binding: FileBinding): Promise<PermissionState>;
  /** Rejects if the file can't be reached, including when it no longer exists. */
  stat(binding: FileBinding): Promise<Revision>;
  /**
   * Resolves only once the bytes are in place, with the revision that resulted. A host that can
   * check `expected` rejects with FileChangedError if the file no longer matches it. The browser's
   * can't, so there the check before this call is the only one.
   */
  write(binding: FileBinding, bytes: Uint8Array, expected?: Revision): Promise<Revision>;
  /** Where this exists, a conflict can offer Reload. The revision is from before the bytes were read. */
  reread?(binding: FileBinding): Promise<{ bytes: ArrayBuffer; revision: Revision }>;
  isSame(a: FileBinding, b: FileBinding): Promise<boolean>;
  /** Puts a copy somewhere of the user's choosing. The open file stays bound where it was. */
  exportCopy(name: string, bytes: Uint8Array): Promise<void>;
  openExternal(href: string): void;
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
}

export function storedBinding(binding: FileBinding | undefined): StoredBinding {
  if (binding?.kind === 'web') return { handle: binding.handle };
  if (binding?.kind === 'native') return { nativePath: binding.path };
  return {};
}

export function bindingFromStored(stored: StoredBinding): FileBinding | undefined {
  if (stored.handle) return { kind: 'web', handle: stored.handle };
  if (stored.nativePath) return { kind: 'native', path: stored.nativePath };
  return undefined;
}

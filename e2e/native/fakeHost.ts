import type { FileBinding, FileHost, PickedFile, Revision } from '../../src/platform/host';

/**
 * A stand-in for the native host, built into a separate test bundle (`vite build --mode
 * native-fake`) and never into the website. It keeps a pretend disk in localStorage, which outlives
 * a reload, and its grants in memory, which don't: a reload here plays the part of restarting the app.
 */
const DISK_KEY = 'fake-disk';

interface DiskFile {
  bytes: number[];
  modifiedMs: number;
}

export interface FakeControls {
  /** What the next dialogs will answer. An empty list or null means the user cancelled. */
  nextOpen: string[];
  nextSave: string | null;
  /** The answer to the native confirmation needed for a path that has no grant. */
  regrant: 'granted' | 'denied';
  /** Make writes fail with this reason. */
  failWrite: string | null;
  writes: string[];
  exports: string[];
  opened: string[];
  put(path: string, text: string): void;
  remove(path: string): void;
  read(path: string): string | null;
}

const loadDisk = (): Record<string, DiskFile> => JSON.parse(localStorage.getItem(DISK_KEY) ?? '{}');
const saveDisk = (disk: Record<string, DiskFile>) => localStorage.setItem(DISK_KEY, JSON.stringify(disk));
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

const pathOf = (binding: FileBinding): string => {
  if (binding.kind !== 'native') throw new Error('The native host was given a browser file handle');
  return binding.path;
};

function store(path: string, bytes: number[]): Revision {
  const disk = loadDisk();
  // Strictly increasing, so that any write is seen as a change even within one millisecond.
  const modifiedMs = Math.max(Date.now(), (disk[path]?.modifiedMs ?? 0) + 1);
  disk[path] = { bytes, modifiedMs };
  saveDisk(disk);
  return { size: bytes.length, modifiedMs };
}

export function createFakeHost(): { host: FileHost; controls: FakeControls } {
  const grants = new Set<string>();
  const controls: FakeControls = {
    nextOpen: [],
    nextSave: null,
    regrant: 'granted',
    failWrite: null,
    writes: [],
    exports: [],
    opened: [],
    put: (path, text) => void store(path, Array.from(new TextEncoder().encode(text))),
    remove: (path) => {
      const disk = loadDisk();
      delete disk[path];
      saveDisk(disk);
    },
    read: (path) => {
      const found = loadDisk()[path];
      return found ? new TextDecoder().decode(new Uint8Array(found.bytes)) : null;
    },
  };

  const host: FileHost = {
    canOverwrite: true,
    canDownload: false,
    async pickFiles() {
      const paths = controls.nextOpen;
      controls.nextOpen = [];
      return paths.map((path): PickedFile => {
        const found = loadDisk()[path];
        if (!found) throw new Error(`No such file: ${path}`);
        grants.add(path);
        return {
          file: {
            name: baseName(path),
            size: found.bytes.length,
            lastModified: found.modifiedMs,
            arrayBuffer: async () => new Uint8Array(found.bytes).buffer,
          },
          binding: { kind: 'native', path },
        };
      });
    },
    async filesFromDrop(data) {
      return Array.from(data.files).map((file) => ({ file }));
    },
    async pickSaveTarget() {
      const path = controls.nextSave;
      controls.nextSave = null;
      if (!path) return null;
      grants.add(path);
      return { binding: { kind: 'native', path }, name: baseName(path) };
    },
    async ensureWritable(binding) {
      const path = pathOf(binding);
      if (grants.has(path)) return 'granted';
      if (controls.regrant === 'granted') grants.add(path);
      return controls.regrant;
    },
    async stat(binding) {
      const found = loadDisk()[pathOf(binding)];
      if (!found) throw new Error('The file no longer exists');
      return { size: found.bytes.length, modifiedMs: found.modifiedMs };
    },
    async write(binding, bytes) {
      const path = pathOf(binding);
      if (!grants.has(path)) throw new Error('Write to a path with no grant');
      if (controls.failWrite) throw new Error(controls.failWrite);
      controls.writes.push(path);
      return store(path, Array.from(bytes));
    },
    async isSame(a, b) {
      return pathOf(a) === pathOf(b);
    },
    async exportCopy(_name, bytes) {
      const path = controls.nextSave;
      controls.nextSave = null;
      if (!path) return;
      controls.exports.push(path);
      store(path, Array.from(bytes));
    },
    openExternal(href) {
      controls.opened.push(href);
    },
  };
  return { host, controls };
}

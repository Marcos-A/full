import type { PickedFile } from '../platform/host';

/** What native code says about a file. Without `access` the file can't be read. */
export interface Offered {
  name: string;
  access: { grant: string; path: string; size: number; modifiedMs: number; ticket?: string } | null;
}

export type NativeEvent =
  | { kind: 'dragEntered' }
  | { kind: 'dragLeft' }
  | { kind: 'files'; files: Offered[] }
  | { kind: 'closeFile' }
  | { kind: 'closeRequested'; id: number };

export interface ClosingEvents {
  closeFile(): void;
  closeRequested(id: number): void;
}

export type ReadGranted = (grant: string) => Promise<ArrayBuffer>;

/** Everything here runs in the shape the shared open flow expects, so it behaves as a web open does. */
export function pickedFromOffered({ name, access }: Offered, read: ReadGranted): PickedFile {
  if (!access) {
    return {
      // -1 can't match an open file, so this reaches the read and is reported instead of focusing a tab.
      file: { name, size: 0, lastModified: -1, arrayBuffer: () => Promise.reject(new Error('No access to this file')) },
    };
  }
  const { grant, path, size, modifiedMs, ticket } = access;
  return {
    file: { name, size, lastModified: modifiedMs, arrayBuffer: () => read(grant) },
    binding: { kind: 'native', path, grant, ticket },
  };
}

/** A native drag doesn't reach the page as a drag, so the shared drop overlay is told this way. */
function announceDrag(type: 'dragenter' | 'dragleave'): void {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(new File([], 'file'));
  window.dispatchEvent(new DragEvent(type, { dataTransfer }));
}

/** Files are opened one batch at a time, so that a file sent twice in a row can't open twice. */
export function nativeEventHandler(
  read: ReadGranted,
  openFiles: (files: PickedFile[]) => Promise<void>,
  closing: ClosingEvents,
): (event: NativeEvent) => void {
  let queue = Promise.resolve();
  return (event) => {
    if (event.kind === 'files') {
      const picked = event.files.map((offered) => pickedFromOffered(offered, read));
      queue = queue.then(() => openFiles(picked));
    } else if (event.kind === 'closeFile') {
      closing.closeFile();
    } else if (event.kind === 'closeRequested') {
      closing.closeRequested(event.id);
    } else {
      announceDrag(event.kind === 'dragEntered' ? 'dragenter' : 'dragleave');
    }
  };
}

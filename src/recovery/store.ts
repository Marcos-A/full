import { IDBPDatabase, openDB } from 'idb';
import { MAX_RECOVERY_ENTRIES } from '../config';
import type { DocKind } from '../core/fileTypes';
import type { LineEnding } from '../core/lineEndings';

export interface DocumentRecord {
  id: string;
  sessionId: string;
  name: string;
  kind: DocKind;
  handle?: FileSystemFileHandle;
  originalBytes: ArrayBuffer;
  currentText: string;
  lastSavedText: string;
  hasUnsavedChanges: boolean;
  encoding: string;
  hasBom: boolean;
  lineEnding: LineEnding;
  delimiter?: string;
  fileSize: number;
  fileLastModified: number;
  updatedAt: number;
}

const DB_NAME = 'full';
const STORE = 'documents';

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore(STORE, { keyPath: 'id' });
    },
  });
  return dbPromise;
}

export async function putRecord(record: DocumentRecord): Promise<void> {
  await (await db()).put(STORE, record);
}

export async function deleteRecord(id: string): Promise<void> {
  await (await db()).delete(STORE, id);
}

export async function allRecords(): Promise<DocumentRecord[]> {
  return (await db()).getAll(STORE) as Promise<DocumentRecord[]>;
}

/** Which records to evict: clean files first (oldest first), then the oldest unsaved ones. */
export function selectEvictions<T extends Pick<DocumentRecord, 'id' | 'hasUnsavedChanges' | 'updatedAt'>>(
  abandoned: T[],
  max: number = MAX_RECOVERY_ENTRIES,
): T[] {
  const excess = abandoned.length - max;
  if (excess <= 0) return [];
  const ordered = abandoned.slice().sort((a, b) => {
    if (a.hasUnsavedChanges !== b.hasUnsavedChanges) return a.hasUnsavedChanges ? 1 : -1;
    return a.updatedAt - b.updatedAt;
  });
  return ordered.slice(0, excess);
}

/**
 * Claim an abandoned record. Web Locks can't be awaited inside an IndexedDB transaction, so the
 * caller queries them first; ownership is then re-checked and changed in one read-write
 * transaction. IndexedDB serializes those, so of two racing pages only one can succeed.
 */
export async function claimRecord(
  id: string,
  newSessionId: string,
  liveSessions: ReadonlySet<string>,
): Promise<DocumentRecord | null> {
  const tx = (await db()).transaction(STORE, 'readwrite');
  const record = (await tx.store.get(id)) as DocumentRecord | undefined;
  if (!record || liveSessions.has(record.sessionId)) {
    await tx.done;
    return null;
  }
  const claimed = { ...record, sessionId: newSessionId };
  await tx.store.put(claimed);
  await tx.done;
  return claimed;
}

/** Delete the records no live page owns, in one transaction, and only those. */
export async function deleteAbandoned(
  liveSessions: ReadonlySet<string>,
  only?: ReadonlySet<string>,
): Promise<void> {
  const tx = (await db()).transaction(STORE, 'readwrite');
  const records = (await tx.store.getAll()) as DocumentRecord[];
  await Promise.all(
    records
      .filter((r) => !liveSessions.has(r.sessionId) && (!only || only.has(r.id)))
      .map((r) => tx.store.delete(r.id)),
  );
  await tx.done;
}

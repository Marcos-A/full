import { IDBPDatabase, openDB } from 'idb';
import type { DocKind } from '../core/fileTypes';
import { liveSessions, sessionId } from './session';

/**
 * The last session, reopened as it was left. Each page keeps one small record of its tabs: in
 * localStorage, which can be written synchronously as a page goes away, and in a small database of
 * its own, which the Mac app waits for before quitting, as WebKit may not have written localStorage
 * to disk by then. Reading takes the newer of the two. The files' content stays in the recovery
 * store, as before: this only says which records were open, in what order, which one was in front,
 * and how each was being viewed.
 */

export interface TabView {
  view?: 'split' | 'source' | 'rendered';
  csvMode?: 'grid' | 'raw';
  headerRow?: boolean;
  wrap?: boolean;
  splitEditor?: boolean;
  splitRatio?: number;
  /** The source editor's main selection. */
  selection?: { anchor: number; head: number };
  /** The position at the top of the source editor, which survives a different window size. */
  topPos?: number;
  /** The rendered side's scroll, as a fraction, when it's shown alone. */
  renderedScroll?: number;
  cell?: { row: number; col: number };
  gridScroll?: { top: number; left: number };
}

export interface SessionTab {
  id: string;
  name: string;
  kind: DocKind;
  /** For the tab bar, before the file itself has been read. */
  dirty: boolean;
  view: TabView;
}

export interface SessionRecord {
  sessionId: string;
  tabs: SessionTab[];
  active: string | null;
  updatedAt: number;
  /**
   * When the page was closed, or last hidden, which may be the last anyone sees of it. A session
   * that crashed has none, so it isn't reopened by itself: its files wait in the recovery list.
   */
  closedAt?: number;
  /**
   * Until when this session waits for a window that's opening to take it over: a tab moved to a
   * new window, or one of the other windows of the last session. Meanwhile its files are nobody's
   * to recover, and it isn't reopened or forgotten by anyone else.
   */
  reservedUntil?: number;
}

/** How long a session waits for its window. Opening one takes well under a second. */
export const RESERVE_MS = 30_000;
/** Windows that closed within this of the last one, as all of them do on quitting, reopen with it. */
const SAME_QUIT_MS = 10_000;

const reserved = (record: SessionRecord, now = Date.now()) => record.reservedUntil !== undefined && record.reservedUntil > now;

const PREFIX = 'full.session.';
const LOCK = 'full-last-session';

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function localSessions(): SessionRecord[] {
  const store = storage();
  if (!store) return [];
  const records: SessionRecord[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const record = JSON.parse(store.getItem(key) ?? '') as SessionRecord;
      if (record && Array.isArray(record.tabs)) records.push(record);
    } catch {
      // A damaged record is simply not reopened.
    }
  }
  return records;
}

const DB_NAME = 'full-sessions';
const DB_STORE = 'sessions';
let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore(DB_STORE, { keyPath: 'sessionId' });
    },
  });
  return dbPromise;
}

/** Every page's record, the newer copy of each. */
export async function readSessions(): Promise<SessionRecord[]> {
  const newest = new Map<string, SessionRecord>();
  const keep = (record: SessionRecord) => {
    const known = newest.get(record.sessionId);
    if (!known || record.updatedAt > known.updatedAt) newest.set(record.sessionId, record);
  };
  localSessions().forEach(keep);
  try {
    ((await (await db()).getAll(DB_STORE)) as SessionRecord[]).forEach(keep);
  } catch {
    // Without the database, localStorage's copy is all there is.
  }
  return [...newest.values()];
}

function store(record: SessionRecord): Promise<void> {
  try {
    storage()?.setItem(PREFIX + record.sessionId, JSON.stringify(record));
  } catch {
    // Storage full or refused: the database may still take it.
  }
  return db().then((database) => database.put(DB_STORE, record)).then(() => undefined, () => undefined);
}

/** Writes the record of a session that a window about to open will take over. */
export function reserveSession(tabs: SessionTab[], active: string | null): Promise<string> {
  const id = crypto.randomUUID();
  const now = Date.now();
  return store({ sessionId: id, tabs, active, updatedAt: now, reservedUntil: now + RESERVE_MS }).then(() => id);
}

/** This page's own record, as written before it took the session over. */
export async function ownSession(): Promise<SessionRecord | null> {
  return (await readSessions()).find((record) => record.sessionId === sessionId && record.tabs.length > 0) ?? null;
}

let lastWritten = '';
let lastClosing = false;
let lastSave: Promise<void> = Promise.resolve();

/**
 * Writes this page's record, unless nothing in it changed. localStorage synchronously, so it works
 * in pagehide, and the database after it. `saved` resolves once the database has it.
 */
export function writeSession(tabs: SessionTab[], active: string | null, closing = false): void {
  const body = JSON.stringify({ tabs, active });
  // On the way out it's written anyway: the time it was closed is what makes it the last session.
  if (body === lastWritten && !closing && !lastClosing) return;
  lastWritten = body;
  lastClosing = closing;
  const now = Date.now();
  const record: SessionRecord = { sessionId, tabs, active, updatedAt: now, ...(closing ? { closedAt: now } : {}) };
  // localStorage straight away, for pagehide, and the database in order after it.
  try {
    storage()?.setItem(PREFIX + sessionId, JSON.stringify(record));
  } catch {
    // Storage full or refused: the database may still take it.
  }
  lastSave = lastSave.then(() => db().then((database) => database.put(DB_STORE, record)).then(() => undefined, () => undefined));
}

/** Resolves once the last record written is in the database. */
export function sessionSaved(): Promise<void> {
  return lastSave;
}

export async function removeSession(id: string): Promise<void> {
  try {
    storage()?.removeItem(PREFIX + id);
  } catch {
    // Nothing to do.
  }
  try {
    await (await db()).delete(DB_STORE, id);
  } catch {
    // Nothing to do.
  }
}

export interface LastSession {
  last: SessionRecord | null;
  /** The other windows closed by the same quit, for the Mac app to reopen as windows of their own. */
  others: SessionRecord[];
}

/**
 * Takes the most recently closed session that had files open, if no other page has taken it, and
 * forgets older ones: their files stay in the recovery list, as before. Two pages opening at once
 * do this one after the other, so only one of them gets it. The session's tabs are written into
 * this page's record straight away, so other pages leave their files out of the recovery list.
 *
 * With `withOthers`, the sessions of the other windows closed by the same quit are kept too,
 * reserved for the windows this page then opens for them. A session already reserved for a window
 * that's opening is left alone.
 */
export function takeLastSession(withOthers = false): Promise<LastSession> {
  const run = async (): Promise<LastSession> => {
    const live = await liveSessions();
    const now = Date.now();
    const abandoned = (await readSessions()).filter(
      (record) => record.sessionId !== sessionId && !live.has(record.sessionId) && !reserved(record, now),
    );
    const closed = abandoned.filter((record) => record.tabs.length > 0 && record.closedAt !== undefined);
    closed.sort((a, b) => b.closedAt! - a.closedAt!);
    const last = closed[0] ?? null;
    const others = withOthers && last ? closed.slice(1).filter((record) => last.closedAt! - record.closedAt! <= SAME_QUIT_MS) : [];
    if (last) writeSession(last.tabs, last.active);
    const kept = new Set(others.map((record) => record.sessionId));
    await Promise.all(others.map((record) => store({ ...record, reservedUntil: now + RESERVE_MS })));
    await Promise.all(abandoned.filter((record) => !kept.has(record.sessionId)).map((record) => removeSession(record.sessionId)));
    await sessionSaved();
    return { last, others };
  };
  if (!navigator.locks) return run();
  return navigator.locks.request(LOCK, run) as Promise<LastSession>;
}

/**
 * Records that a live page has open or is about to reopen, or that wait for a window that's
 * opening, which the recovery list leaves out.
 */
export async function reservedRecords(live: ReadonlySet<string>): Promise<Set<string>> {
  const ids = new Set<string>();
  const now = Date.now();
  for (const record of await readSessions()) {
    if (!live.has(record.sessionId) && !reserved(record, now)) continue;
    for (const tab of record.tabs) ids.add(tab.id);
  }
  return ids;
}

/** For "Clear all recovery data": every session no page has open. */
export async function clearAbandonedSessions(): Promise<void> {
  const live = await liveSessions();
  for (const record of await readSessions()) if (!live.has(record.sessionId)) await removeSession(record.sessionId);
}

/** Whether there may be a session to reopen, known without waiting for anything. */
export function maySessionExist(): boolean {
  return localSessions().some((record) => record.sessionId !== sessionId && record.tabs.length > 0 && record.closedAt !== undefined);
}

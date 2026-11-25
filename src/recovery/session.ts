const PREFIX = 'session:';

/** This page's session. A new window of the Mac app may take over one, see adoptSession. */
export let sessionId: string = crypto.randomUUID();

/** What crypto.randomUUID() makes, and the only shape a session id is accepted in. */
export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Takes over a session whose files are waiting in the recovery store: a tab moved out of another
 * window, or a window of the last session reopening. Only before the page holds its lock.
 */
export function adoptSession(id: string): boolean {
  if (!SESSION_ID.test(id)) return false;
  sessionId = id;
  return true;
}

/** Resolves once this page holds its lock, which it keeps until the page goes away. */
export function acquireSessionLock(): Promise<void> {
  return new Promise((ready) => {
    void navigator.locks.request(
      PREFIX + sessionId,
      () =>
        new Promise<void>(() => {
          ready();
        }),
    );
  });
}

/** Sessions with a held lock. Pending requests don't count: those are other pages watching. */
export async function liveSessions(): Promise<Set<string>> {
  const { held = [] } = await navigator.locks.query();
  const live = new Set<string>();
  for (const lock of held) {
    if (lock.name?.startsWith(PREFIX)) live.add(lock.name.slice(PREFIX.length));
  }
  return live;
}

/** Calls back when another session's page goes away (the queued request is then granted). */
export function watchSession(id: string, gone: () => void): void {
  void navigator.locks.request(PREFIX + id, { mode: 'shared' }, () => undefined).then(gone, () => undefined);
}

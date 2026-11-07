const PREFIX = 'session:';

export const sessionId: string = crypto.randomUUID();

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

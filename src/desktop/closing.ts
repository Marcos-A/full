import { ws } from '../doc/workspace';
import { sessionSaved, type Closed } from '../recovery/lastSession';

export type CloseAnswer = 'asking' | 'close' | 'stay';

/** Holding Cmd+W repeats it, and running out of files that way shouldn't also end the app. */
const REPEAT_GUARD_MS = 500;

let lastFileClosedAt = -Infinity;

/** Cmd+W: closes the file, or the window when there's no file. */
export function closeFileOrWindow(closeWindow: () => void): void {
  if (ws.dialog || ws.paletteQuery !== null || ws.recoveryDialogOpen) return;
  const doc = ws.active;
  if (doc) {
    lastFileClosedAt = performance.now();
    void ws.closeDoc(doc);
  } else if (performance.now() - lastFileClosedAt > REPEAT_GUARD_MS) {
    closeWindow();
  }
}

/**
 * One window of several is closing, by its red button or Cmd+W with no file. Nothing in it will
 * reopen, so this asks about each unsaved file, as closing it would, and the window stays if the
 * user cancels any.
 */
export async function closeThisWindow(close: () => void): Promise<void> {
  if (ws.dialog || ws.recoveryDialogOpen) return;
  if (await ws.closeWindow()) close();
}

/**
 * The app wants to quit, by any route: Cmd+Q, Dock Quit, the last window's close button or logging
 * out. Every window's page is asked, and the app quits once all of them have agreed.
 * Nothing is lost, so nothing is asked: everything typed reaches the recovery store first, and the
 * files reopen as they were at the next launch. Only if storing failed does it ask about each
 * unsaved file, as closing would then lose them. Any failure keeps the app open, because closing
 * must be something this page agreed to.
 */
export async function answerCloseRequest(id: number, answer: (id: number, answer: CloseAnswer, closed?: Closed) => void): Promise<void> {
  answer(id, 'asking');
  let close = false;
  let closed: Closed | undefined;
  try {
    await ws.flushPersistence();
    closed = ws.writeSessionNow(true);
    await sessionSaved();
    if (ws.storageProblem) {
      close = await ws.closeAll();
      // Its files were closed rather than kept, so the window has nothing to reopen.
      closed = { ...closed, reopens: false };
    } else {
      close = true;
    }
  } catch (error) {
    console.error(error);
  }
  // With Close, native code notes where this window is, for the next launch to put it back.
  answer(id, close ? 'close' : 'stay', close ? closed : undefined);
}

import { ws } from '../doc/workspace';
import { sessionSaved } from '../recovery/lastSession';

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
 * The app wants to close, by any route: Cmd+Q, Dock Quit, the window's close button or logging out.
 * Nothing is lost, so nothing is asked: everything typed reaches the recovery store first, and the
 * files reopen as they were at the next launch. Only if storing failed does it ask about each
 * unsaved file, as closing would then lose them. Any failure keeps the app open, because closing
 * must be something this page agreed to.
 */
export async function answerCloseRequest(id: number, answer: (id: number, answer: CloseAnswer) => void): Promise<void> {
  answer(id, 'asking');
  let close = false;
  try {
    await ws.flushPersistence();
    ws.writeSessionNow(true);
    await sessionSaved();
    close = ws.storageProblem ? await ws.closeAll() : true;
  } catch (error) {
    console.error(error);
  }
  answer(id, close ? 'close' : 'stay');
}

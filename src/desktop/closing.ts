import { ws } from '../doc/workspace';

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
 * The app wants to close, by any route. Everything typed reaches the recovery store before anything
 * is asked, so if macOS ends the app during the question the work is still there. Any failure keeps
 * the app open, because closing must be something this page agreed to.
 */
export async function answerCloseRequest(id: number, answer: (id: number, answer: CloseAnswer) => void): Promise<void> {
  answer(id, 'asking');
  let close = false;
  try {
    await ws.flushPersistence();
    close = await ws.closeAll();
  } catch (error) {
    console.error(error);
  }
  answer(id, close ? 'close' : 'stay');
}

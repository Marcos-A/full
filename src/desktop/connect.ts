import { Channel, invoke } from '@tauri-apps/api/core';
import { ws } from '../doc/workspace';
import { answerCloseRequest, closeFileOrWindow } from './closing';
import { readGranted } from './host';
import { keepMenuUpToDate, runMenuCommand } from './menu';
import { nativeEventHandler, type NativeEvent } from './nativeEvents';
import { timedOpen, timedRead } from './timings';

/** Asks for files dropped or sent by Finder, including any that arrived before the page was ready. */
export function connectNativeEvents(): void {
  const channel = new Channel<NativeEvent>();
  channel.onmessage = nativeEventHandler(timedRead(readGranted), timedOpen((files) => ws.openFiles(files)), {
    closeFile: () => closeFileOrWindow(() => void invoke('close_window')),
    closeRequested: (id) => void answerCloseRequest(id, (asked, answer) => void invoke('answer_close', { id: asked, answer })),
    menuCommand: runMenuCommand,
  });
  invoke('connect_native_events', { channel }).catch(() => console.warn("Couldn't connect to native events"));
  keepMenuUpToDate((state) => {
    invoke('update_menu', { ...state }).catch(() => console.warn("Couldn't update the menu"));
  });
}

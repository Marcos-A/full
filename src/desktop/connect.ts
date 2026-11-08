import { Channel, invoke } from '@tauri-apps/api/core';
import { ws } from '../doc/workspace';
import { answerCloseRequest, closeFileOrWindow } from './closing';
import { readGranted } from './host';
import { nativeEventHandler, type NativeEvent } from './nativeEvents';

/** Asks for files dropped or sent by Finder, including any that arrived before the page was ready. */
export function connectNativeEvents(): void {
  const channel = new Channel<NativeEvent>();
  channel.onmessage = nativeEventHandler(readGranted, (files) => ws.openFiles(files), {
    closeFile: () => closeFileOrWindow(() => void invoke('close_window')),
    closeRequested: (id) => void answerCloseRequest(id, (asked, answer) => void invoke('answer_close', { id: asked, answer })),
  });
  invoke('connect_native_events', { channel }).catch(() => console.warn("Couldn't connect to native events"));
}

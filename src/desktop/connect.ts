import { Channel, invoke } from '@tauri-apps/api/core';
import { ws } from '../doc/workspace';
import { readGranted } from './host';
import { nativeEventHandler, type NativeEvent } from './nativeEvents';

/** Asks for files dropped or sent by Finder, including any that arrived before the page was ready. */
export function connectNativeEvents(): void {
  const channel = new Channel<NativeEvent>();
  channel.onmessage = nativeEventHandler(readGranted, (files) => ws.openFiles(files));
  invoke('connect_native_events', { channel }).catch(() => console.warn("Couldn't connect to native events"));
}

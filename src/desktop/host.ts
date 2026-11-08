import { invoke } from '@tauri-apps/api/core';
import type { FileBinding, FileHost } from '../platform/host';
import { webHost } from '../platform/webHost';
import { pickedFromOffered, type Offered } from './nativeEvents';

export const readGranted = (grant: string) => invoke<ArrayBuffer>('read_granted', { grant });

const nativePath = (binding: FileBinding) => (binding.kind === 'native' ? binding.path : null);

/**
 * Opening is native. Saving still goes through the web path, a download, which M0 showed works in
 * the app, until M4 replaces it.
 */
export const desktopHost: FileHost = {
  ...webHost,
  pickFiles: async () => {
    const offered = await invoke<Offered[]>('pick_files');
    return offered.map((file) => pickedFromOffered(file, readGranted));
  },
  // Native code gives each file its canonical path, so equal paths are the same file.
  isSame: async (a, b) => nativePath(a) !== null && nativePath(a) === nativePath(b),
  openExternal: (href) => {
    invoke('open_external', { href }).catch(() => console.warn("Couldn't open a link"));
  },
};

import { invoke } from '@tauri-apps/api/core';
import type { FileHost } from '../platform/host';
import { webHost } from '../platform/webHost';

/**
 * Files still go through the web paths, which M0 showed work in the app: the file input to open,
 * and a download to save a copy. M3 and M4 replace them with native ones.
 */
export const desktopHost: FileHost = {
  ...webHost,
  openExternal: (href) => {
    invoke('open_external', { href }).catch(() => console.warn("Couldn't open a link"));
  },
};

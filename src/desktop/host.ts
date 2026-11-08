import { invoke } from '@tauri-apps/api/core';
import { PERSIST_MAX_WAIT_MS } from '../config';
import { NATIVE_FAILURES, type NativeFailure } from '../platform/desktopStrings';
import { FileChangedError, SaveCancelled, type FileBinding, type FileHost, type Revision } from '../platform/host';
import { webHost } from '../platform/webHost';
import { language } from '../strings';
import { pickedFromOffered, type Offered } from './nativeEvents';

export const readGranted = (grant: string) => invoke<ArrayBuffer>('read_granted', { grant });

const nativePath = (binding: FileBinding) => (binding.kind === 'native' ? binding.path : null);

const failure = (code: NativeFailure) => new Error(NATIVE_FAILURES[language][code]);

/** Native code answers with a code that never holds a path, and the words for it are chosen here. */
async function native<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (code) {
    if (code === 'changed') throw new FileChangedError(NATIVE_FAILURES[language].changed);
    throw failure(typeof code === 'string' && code in NATIVE_FAILURES[language] ? (code as NativeFailure) : 'other');
  }
}

/** A restored file knows its path but has no grant, and the page can't get one for a path. */
function grantOf(binding: FileBinding): string {
  if (binding.kind !== 'native' || !binding.grant) throw failure('noGrant');
  return binding.grant;
}

/**
 * Pressing Cmd+S again during a slow save starts a second one. Its check waits for the first to
 * finish, so that the first's own write doesn't look like another program's.
 */
const writing = new Map<string, Promise<unknown>>();

function track(grant: string, result: Promise<Revision>): Promise<Revision> {
  const settled = Promise.allSettled([writing.get(grant), result]);
  writing.set(grant, settled);
  void settled.then(() => {
    if (writing.get(grant) === settled) writing.delete(grant);
  });
  return result;
}

async function stat(binding: FileBinding): Promise<Revision> {
  const grant = grantOf(binding);
  await writing.get(grant);
  return native(invoke<Revision>('stat_granted', { grant }));
}

async function write(binding: FileBinding, bytes: Uint8Array, expected?: Revision): Promise<Revision> {
  const grant = grantOf(binding);
  const headers: Record<string, string> = { 'x-full-grant': grant };
  if (expected) {
    headers['x-full-size'] = String(expected.size);
    headers['x-full-modified-ms'] = String(expected.modifiedMs);
  }
  return track(grant, native(invoke<Revision>('write_granted', bytes, { headers })));
}

interface SaveTarget {
  name: string;
  grant: string;
  path: string;
  ticket?: string;
}

async function pickSaveTarget(suggestedName: string) {
  const target = await native(invoke<SaveTarget | null>('pick_save_target', { suggestedName }));
  if (!target) return null;
  const binding: FileBinding = { kind: 'native', path: target.path, grant: target.grant, ticket: target.ticket };
  return { binding, name: target.name };
}

interface RestoredAccess {
  grant: string;
}

/**
 * The first save of a restored file. The ticket is all that goes to native code, and native code
 * finds the path and shows the confirmation itself. Without a ticket, Save As is the way out.
 */
async function ensureWritable(binding: FileBinding): Promise<PermissionState> {
  if (binding.kind === 'native' && !binding.grant && binding.ticket) {
    const access = await native(
      invoke<RestoredAccess | null>('confirm_restored_save', { ticket: binding.ticket, language }),
    );
    if (!access) throw new SaveCancelled();
    binding.grant = access.grant;
  }
  grantOf(binding);
  return 'granted';
}

export const desktopHost: FileHost = {
  ...webHost,
  canOverwrite: true,
  canDownload: false,
  persistMaxWaitMs: PERSIST_MAX_WAIT_MS,
  pickFiles: async () => {
    const offered = await invoke<Offered[]>('pick_files');
    return offered.map((file) => pickedFromOffered(file, readGranted));
  },
  pickSaveTarget,
  ensureWritable,
  stat,
  write,
  reread: async (binding) => {
    const revision = await stat(binding);
    return { bytes: await native(readGranted(grantOf(binding))), revision };
  },
  // Native code gives each file its canonical path, so equal paths are the same file.
  isSame: async (a, b) => nativePath(a) !== null && nativePath(a) === nativePath(b),
  exportCopy: async (name, bytes) => {
    const target = await pickSaveTarget(name);
    if (target) await write(target.binding, bytes);
  },
  openExternal: (href) => {
    invoke('open_external', { href }).catch(() => console.warn("Couldn't open a link"));
  },
};

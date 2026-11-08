import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { kindFromName, SUPPORTED_EXTENSIONS } from '../../src/core/fileTypes';
import { classifyLink } from '../../src/core/urls';
import { desktopHost } from '../../src/desktop/host';
import { pickedFromOffered } from '../../src/desktop/nativeEvents';
import { FileChangedError, SaveCancelled } from '../../src/platform/host';

const invoke = vi.hoisted(() => {
  vi.stubGlobal('window', {}); // Unit tests have no DOM, and the web host looks here when it loads.
  return vi.fn((..._args: unknown[]): Promise<unknown> => Promise.resolve());
});
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

const text = (path: string) => readFileSync(path, 'utf8');
const json = (path: string) => JSON.parse(text(path));
const conf = json('src-tauri/tauri.conf.json');
const directives = (csp: string) => new Map(csp.split(/;\s*/).map((part) => [part.split(' ')[0], part]));

describe('desktop configuration', () => {
  it('has the settled name and identifier, which recovery data depends on', () => {
    expect(conf.productName).toBe('full');
    expect(conf.identifier).toBe('com.marcos-a.full');
  });

  it('has one version number, and a real one', () => {
    const version = json('package.json').version;
    expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(version).not.toBe('0.0.0');
    expect(conf.version).toBe('../package.json');
    expect(text('src-tauri/Cargo.toml')).toContain(`\nversion = "${version}"`);
  });

  it('adds only IPC to the website policy', () => {
    const web = text('deploy/security-headers.conf').match(/Content-Security-Policy "([^"]+)"/)![1];
    const expected = directives(web);
    expected.set('connect-src', "connect-src 'self' ipc: http://ipc.localhost");
    expect(directives(conf.app.security.csp)).toEqual(expected);
    expect(conf.app.security.dangerousDisableAssetCspModification).toEqual(['style-src']);
  });

  it('bundles the app, so that it never loads the website', () => {
    expect(conf.build.frontendDist).toBe('../dist-desktop');
    expect(new URL(conf.build.devUrl).hostname).toBe('localhost');
  });

  it('keeps devtools out of the normal build', () => {
    expect(text('src-tauri/Cargo.toml')).toMatch(/^tauri = \{ version = "[^"]+", features = \[\] \}$/m);
    expect(conf.app.windows[0].devtools).toBeUndefined();
  });

  it('grants the window only what it uses, and to no remote page', () => {
    const capability = json('src-tauri/capabilities/default.json');
    expect(capability.windows).toEqual(['main']);
    expect(capability.permissions).toEqual([
      'allow-open-external',
      'allow-pick-files',
      'allow-read-granted',
      'allow-pick-save-target',
      'allow-stat-granted',
      'allow-write-granted',
      'allow-confirm-restored-save',
      'allow-connect-native-events',
      'allow-answer-close',
      'allow-close-window',
    ]);
    expect(capability.remote).toBeUndefined();
  });

  it('keeps native build output out of git and away from the Docker build', () => {
    const lines = (path: string) => text(path).split('\n');
    expect(lines('.gitignore')).toEqual(expect.arrayContaining(['src-tauri/target/', 'src-tauri/gen/', 'dist-desktop/']));
    expect(lines('.dockerignore')).toEqual(expect.arrayContaining(['src-tauri', 'dist-desktop']));
  });
});

describe('external links', () => {
  it('the shared cases match classifyLink, as they do the check in Rust', () => {
    const cases = text('src-tauri/src/link-cases.txt')
      .split('\n')
      .filter((line) => line && !line.startsWith('#'));
    expect(cases.length).toBeGreaterThan(10);
    for (const line of cases) {
      const tab = line.indexOf('\t');
      const href = line.slice(tab + 1);
      expect(classifyLink(href) === 'external', JSON.stringify(href)).toBe(line.slice(0, tab) === 'external');
    }
  });

  it('go to the native command and nowhere else', () => {
    desktopHost.openExternal('https://example.com/');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('open_external', { href: 'https://example.com/' });
  });
});

describe('native files', () => {
  const commands = [...text('src-tauri/src/main.rs').matchAll(/#\[tauri::command[^\]]*\]\s*(?:async )?fn (\w+)\(([^)]*)\)/g)];

  it('no command takes a path from the page', () => {
    expect(commands.map((match) => match[1]).sort()).toEqual([
      'answer_close',
      'close_window',
      'confirm_restored_save',
      'connect_native_events',
      'open_external',
      'pick_files',
      'pick_save_target',
      'read_granted',
      'stat_granted',
      'write_granted',
    ]);
    for (const [, name, parameters] of commands) expect(parameters, name).not.toMatch(/path|file/i);
  });

  it('every command is behind the capability file', () => {
    const listed = text('src-tauri/build.rs').match(/commands\(&\[([^\]]*)\]/)![1];
    for (const [, name] of commands) expect(listed).toContain(`"${name}"`);
  });

  it('the shared file type cases match kindFromName, as they do the check in Rust', () => {
    const cases = text('src-tauri/src/file-type-cases.txt')
      .split('\n')
      .slice(0, -1)
      .filter((line) => !line.startsWith('#'));
    expect(cases.length).toBeGreaterThan(10);
    for (const line of cases) {
      const tab = line.indexOf('\t');
      expect(kindFromName(line.slice(tab + 1)) !== null, JSON.stringify(line)).toBe(line.slice(0, tab) === 'supported');
    }
  });

  it('Rust knows the same extensions as the frontend', () => {
    const listed = text('src-tauri/src/grants.rs').match(/EXTENSIONS: \[&str; 4\] = \[([^\]]*)\]/)![1];
    expect([...listed.matchAll(/"(\w+)"/g)].map((match) => `.${match[1]}`)).toEqual(SUPPORTED_EXTENSIONS);
  });

  it('a file with access reads through its grant and is bound to its path', async () => {
    const bytes = new ArrayBuffer(2);
    const read = vi.fn(() => Promise.resolve(bytes));
    const { file, binding } = pickedFromOffered(
      { name: 'a.md', access: { grant: 'grant-1', path: '/docs/a.md', size: 2, modifiedMs: 5 } },
      read,
    );
    expect(file).toMatchObject({ name: 'a.md', size: 2, lastModified: 5 });
    expect(binding).toEqual({ kind: 'native', path: '/docs/a.md', grant: 'grant-1', ticket: undefined });
    expect(read).not.toHaveBeenCalled();
    await expect(file.arrayBuffer()).resolves.toBe(bytes);
    expect(read).toHaveBeenCalledExactlyOnceWith('grant-1');
  });

  it('a file without access has no binding and rejects when read', async () => {
    const read = vi.fn();
    const { file, binding } = pickedFromOffered({ name: 'gone.md', access: null }, read);
    expect(binding).toBeUndefined();
    await expect(file.arrayBuffer()).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
  });

  it('files are the same only if native code gave them the same path', async () => {
    const at = (path: string, grant?: string) => ({ kind: 'native', path, grant }) as const;
    await expect(desktopHost.isSame(at('/a.md', 'grant-1'), at('/a.md'))).resolves.toBe(true);
    await expect(desktopHost.isSame(at('/a.md', 'grant-1'), at('/b.md', 'grant-2'))).resolves.toBe(false);
  });
});

describe('saving natively', () => {
  const granted = { kind: 'native', path: '/docs/a.md', grant: 'grant-7' } as const;
  const restored = { kind: 'native', path: '/docs/a.md' } as const;
  const revision = { size: 3, modifiedMs: 1762600000123 };
  const bytes = new Uint8Array([0xff, 0x00, 0x80]);

  beforeEach(() => invoke.mockReset());

  it('offers saving over the original, and no downloads', () => {
    expect(desktopHost.canOverwrite).toBe(true);
    expect(desktopHost.canDownload).toBe(false);
    expect(desktopHost.reread).toBeTypeOf('function');
  });

  it('writes the bytes raw, naming only the grant and the expected revision', async () => {
    invoke.mockResolvedValue(revision);
    await expect(desktopHost.write(granted, bytes, revision)).resolves.toEqual(revision);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('write_granted', bytes, {
      headers: { 'x-full-grant': 'grant-7', 'x-full-size': '3', 'x-full-modified-ms': '1762600000123' },
    });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('/docs');
  });

  it('a file with no grant is never sent to native code', async () => {
    await expect(desktopHost.ensureWritable(restored)).rejects.toThrow('Save As');
    await expect(desktopHost.stat(restored)).rejects.toThrow('Save As');
    await expect(desktopHost.write(restored, bytes, revision)).rejects.toThrow('Save As');
    expect(invoke).not.toHaveBeenCalled();
    await expect(desktopHost.ensureWritable(granted)).resolves.toBe('granted');
  });

  it('a restored file with a ticket sends native code the ticket and nothing else', async () => {
    invoke.mockResolvedValueOnce({ grant: 'grant-3', path: '/docs/a.md', size: 3, modifiedMs: 1 });
    const binding = { kind: 'native', path: '/docs/secret/a.md', ticket: 'ticket-4' } as const;
    const held = { ...binding } as { kind: 'native'; path: string; grant?: string; ticket?: string };
    await expect(desktopHost.ensureWritable(held)).resolves.toBe('granted');
    expect(invoke).toHaveBeenCalledExactlyOnceWith('confirm_restored_save', { ticket: 'ticket-4', language: 'en' });
    expect(JSON.stringify(invoke.mock.calls)).not.toContain('/docs');
    expect(held.grant).toBe('grant-3');
  });

  it('once confirmed, a restored file is not asked about again', async () => {
    invoke.mockResolvedValueOnce({ grant: 'grant-3' });
    const held: { kind: 'native'; path: string; grant?: string; ticket?: string } = { kind: 'native', path: '/a.md', ticket: 'ticket-4' };
    await desktopHost.ensureWritable(held);
    await desktopHost.ensureWritable(held);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('saying no to the confirmation is a cancel and not a failure', async () => {
    invoke.mockResolvedValueOnce(null);
    await expect(desktopHost.ensureWritable({ kind: 'native', path: '/a.md', ticket: 'ticket-4' })).rejects.toBeInstanceOf(SaveCancelled);
  });

  it('a ticket native code no longer knows sends the user to Save As', async () => {
    invoke.mockRejectedValueOnce('noGrant');
    await expect(desktopHost.ensureWritable({ kind: 'native', path: '/a.md', ticket: 'ticket-4' })).rejects.toThrow('Save As');
  });

  it('steady typing has a limit on how long it can go unrecorded', () => {
    expect(desktopHost.persistMaxWaitMs).toBeGreaterThan(500);
  });

  it('a changed file is told apart from other failures, which get their words here', async () => {
    invoke.mockRejectedValueOnce('changed');
    await expect(desktopHost.write(granted, bytes, revision)).rejects.toBeInstanceOf(FileChangedError);
    invoke.mockRejectedValueOnce('diskFull');
    const full = await desktopHost.write(granted, bytes, revision).catch((error) => error);
    expect(full).not.toBeInstanceOf(FileChangedError);
    expect(full.message).toBe('The disk is full.');
    invoke.mockRejectedValueOnce('something new');
    await expect(desktopHost.write(granted, bytes, revision)).rejects.toThrow("couldn't be written");
  });

  it('the Save panel gets only a suggested name, and its answer becomes a binding', async () => {
    invoke.mockResolvedValueOnce({ name: 'b.md', grant: 'grant-9', path: '/docs/b.md' });
    await expect(desktopHost.pickSaveTarget('a.md')).resolves.toEqual({
      binding: { kind: 'native', path: '/docs/b.md', grant: 'grant-9', ticket: undefined },
      name: 'b.md',
    });
    expect(invoke).toHaveBeenCalledExactlyOnceWith('pick_save_target', { suggestedName: 'a.md' });
    invoke.mockResolvedValueOnce(null);
    await expect(desktopHost.pickSaveTarget('a.md')).resolves.toBeNull();
  });

  it('a copy goes through the panel and is checked against what the panel found', async () => {
    invoke.mockResolvedValueOnce({ name: 'copy.md', grant: 'grant-9', path: '/docs/copy.md' }).mockResolvedValueOnce(revision);
    await desktopHost.exportCopy('a.md', bytes);
    expect(invoke).toHaveBeenLastCalledWith('write_granted', bytes, { headers: { 'x-full-grant': 'grant-9' } });
  });

  it('cancelling a copy writes nothing', async () => {
    invoke.mockResolvedValueOnce(null);
    await desktopHost.exportCopy('a.md', bytes);
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('Reload reads the revision before the bytes, so a change in between looks like a change', async () => {
    const order: string[] = [];
    invoke.mockImplementation((command) => {
      order.push(command as string);
      return Promise.resolve(command === 'stat_granted' ? revision : new ArrayBuffer(1));
    });
    const { bytes: read, revision: seen } = await desktopHost.reread!(granted);
    expect(read.byteLength).toBe(1);
    expect(seen).toEqual(revision);
    expect(order).toEqual(['stat_granted', 'read_granted']);
  });

  it('a check made during a save waits for it, so its own write is not a change', async () => {
    let finish: (value: unknown) => void = () => undefined;
    invoke.mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)));
    const saving = desktopHost.write(granted, bytes, revision);
    const newer = { size: 3, modifiedMs: 1762600000999 };
    invoke.mockResolvedValueOnce(newer);
    const check = desktopHost.stat(granted);
    await new Promise((resolve) => setTimeout(resolve));
    expect(invoke).toHaveBeenCalledOnce();
    finish(newer);
    await saving;
    await expect(check).resolves.toEqual(newer);
  });

  it('a check waits for a failed save too, and then goes ahead', async () => {
    invoke.mockRejectedValueOnce('diskFull');
    const saving = desktopHost.write(granted, bytes, revision).catch(() => undefined);
    invoke.mockResolvedValueOnce(revision);
    await expect(desktopHost.stat(granted)).resolves.toEqual(revision);
    await saving;
  });
});

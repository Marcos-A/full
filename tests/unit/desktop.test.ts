import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { kindFromName, SUPPORTED_EXTENSIONS } from '../../src/core/fileTypes';
import { classifyLink } from '../../src/core/urls';
import { desktopHost } from '../../src/desktop/host';
import { pickedFromOffered } from '../../src/desktop/nativeEvents';

const invoke = vi.hoisted(() => {
  vi.stubGlobal('window', {}); // Unit tests have no DOM, and the web host looks here when it loads.
  return vi.fn(() => Promise.resolve());
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
      'allow-connect-native-events',
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
    expect(commands.map((match) => match[1]).sort()).toEqual(['connect_native_events', 'open_external', 'pick_files', 'read_granted']);
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
    expect(binding).toEqual({ kind: 'native', path: '/docs/a.md', grant: 'grant-1' });
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

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { classifyLink } from '../../src/core/urls';
import { desktopHost } from '../../src/desktop/host';

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
    expect(capability.permissions).toEqual(['allow-open-external']);
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

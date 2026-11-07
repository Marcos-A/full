import { expect, Page, test } from '@playwright/test';
import type { FakeControls } from './native/fakeHost';
import { expectClean, expectDirty, idbRecords, open, rendered, runCommand, settle, source } from './helpers';

/**
 * The save flows against a stand-in for the native host, on WebKit, which is the engine the Mac app
 * runs on. The real browser's File System Access API isn't available there, so this is where
 * overwriting, conflicts and failed writes get their WebKit coverage.
 */
const fake = <T>(page: Page, run: (controls: FakeControls, arg: unknown) => T, arg?: unknown) =>
  page.evaluate(
    ({ source, arg }) => new Function('controls', 'arg', `return (${source})(controls, arg)`)((window as unknown as { __fake: FakeControls }).__fake, arg) as T,
    { source: run.toString(), arg },
  );

const put = (page: Page, path: string, text: string) =>
  fake(page, (c, a) => c.put(...(a as [string, string])), [path, text]);
const read = (page: Page, path: string) => fake(page, (c, a) => c.read(a as string), path);
const writes = (page: Page) => fake(page, (c) => c.writes);
const nextSave = (page: Page, path: string | null) =>
  fake(page, (c, a) => void (c.nextSave = a as string | null), path);

async function openFromDisk(page: Page, path: string, text: string) {
  await put(page, path, text);
  await fake(page, (c, a) => void (c.nextOpen = [a as string]), path);
  await runCommand(page, 'Open file');
  await expect(page.getByTestId('tab').filter({ hasText: path.split('/').pop()! })).toHaveCount(1);
}

async function typeAtStart(page: Page, text: string) {
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type(text);
}

const dialog = (page: Page) => page.getByTestId('dialog');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('empty').waitFor();
});

test('nothing mentions downloading, and the browser notice stays away', async ({ page }) => {
  await expect(page.getByTestId('browser-notice')).toHaveCount(0);
  await openFromDisk(page, '/docs/a.txt', 'x\n');
  await page.getByTestId('menu-button').click();
  await expect(page.getByTestId('menu').getByRole('menuitem', { name: 'Save', exact: false }).first()).toBeVisible();
  await expect(page.getByTestId('menu').getByRole('menuitem', { name: 'Download', exact: false })).toHaveCount(0);
});

test('the interface talks about the computer, not a browser', async ({ page }) => {
  await expect(page.getByTestId('empty')).toContainText('Files stay on this computer');
  await expect(page.locator('body')).not.toContainText('browser');
});

test.describe('in Catalan', () => {
  test.use({ locale: 'ca-ES' });
  test('the desktop wording and the copy button are translated', async ({ page }) => {
    await expect(page.getByTestId('empty')).toContainText('aquest ordinador');
    await open(page, { name: 'a.txt', bytes: 'x\n' });
    await typeAtStart(page, 'Z');
    await settle(page);
    await page.reload();
    await expect(page.getByTestId('recovery-entry').getByRole('button', { name: 'Desa una còpia' })).toBeVisible();
  });
});

test('Save replaces the original and keeps its line endings', async ({ page }) => {
  await openFromDisk(page, '/docs/file.md', 'one\r\ntwo\r\n');
  await typeAtStart(page, 'x');
  await expectDirty(page);
  await page.keyboard.press('ControlOrMeta+S');
  await expect(page.getByTestId('notice-info')).toContainText('Saved file.md');
  await expectClean(page);
  expect(await read(page, '/docs/file.md')).toBe('xone\r\ntwo\r\n');
});

test('Save on an unedited file performs no write', async ({ page }) => {
  await openFromDisk(page, '/docs/file.txt', 'same\n');
  await page.keyboard.press('ControlOrMeta+S');
  await expect(page.getByTestId('notice-info')).toContainText('No changes');
  expect(await writes(page)).toEqual([]);
});

test('Save As writes to the chosen file, then Save goes there', async ({ page }) => {
  await openFromDisk(page, '/docs/in.txt', 'hello\n');
  await nextSave(page, '/docs/out.txt');
  await page.keyboard.press('ControlOrMeta+Shift+S');
  await expect(page.getByTestId('tab').filter({ hasText: 'out.txt' })).toHaveCount(1);
  expect(await read(page, '/docs/out.txt')).toBe('hello\n');
  await typeAtStart(page, 'Z');
  await page.keyboard.press('ControlOrMeta+S');
  await expectClean(page);
  expect(await read(page, '/docs/out.txt')).toBe('Zhello\n');
  expect(await read(page, '/docs/in.txt')).toBe('hello\n');
});

test('a file with nowhere to go: the first Save asks, and cancelling writes nothing', async ({ page }) => {
  await open(page, { name: 'dropped.txt', bytes: 'hi\n' });
  await typeAtStart(page, 'Z');
  await nextSave(page, null);
  await page.keyboard.press('ControlOrMeta+S');
  await settle(page);
  await expectDirty(page);
  expect(await writes(page)).toEqual([]);

  await nextSave(page, '/docs/dropped.txt');
  await page.keyboard.press('ControlOrMeta+S');
  await expectClean(page);
  expect(await read(page, '/docs/dropped.txt')).toBe('Zhi\n');
});

test('the same path opened twice focuses its tab', async ({ page }) => {
  await openFromDisk(page, '/docs/a.txt', 'x\n');
  await openFromDisk(page, '/docs/b.txt', 'y\n');
  await fake(page, (c) => void (c.nextOpen = ['/docs/a.txt']));
  await runCommand(page, 'Open file');
  await expect(page.getByTestId('tab').filter({ hasText: 'a.txt' })).toHaveClass(/active/);
  await expect(page.getByTestId('tab')).toHaveCount(2);
});

test('an external change asks before anything is overwritten', async ({ page }) => {
  await openFromDisk(page, '/docs/file.md', 'original\n');
  await typeAtStart(page, 'mine ');
  await put(page, '/docs/file.md', 'theirs, longer text\n');

  await page.keyboard.press('ControlOrMeta+S');
  await expect(dialog(page)).toContainText('changed outside');
  expect(await read(page, '/docs/file.md')).toBe('theirs, longer text\n');
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await expectDirty(page);
  expect(await read(page, '/docs/file.md')).toBe('theirs, longer text\n');

  await page.keyboard.press('ControlOrMeta+S');
  await dialog(page).getByRole('button', { name: 'Overwrite' }).click();
  await expectClean(page);
  expect(await read(page, '/docs/file.md')).toBe('mine original\n');

  // Having saved, its own write isn't reported as an external change.
  await typeAtStart(page, 'more ');
  await page.keyboard.press('ControlOrMeta+S');
  await expectClean(page);
  await expect(dialog(page)).toHaveCount(0);
});

test('an external change can go to Save As, leaving the other version alone', async ({ page }) => {
  await openFromDisk(page, '/docs/file.md', 'original\n');
  await typeAtStart(page, 'mine ');
  await put(page, '/docs/file.md', 'theirs\n');
  await page.keyboard.press('ControlOrMeta+S');
  await nextSave(page, '/docs/mine.md');
  await dialog(page).getByRole('button', { name: 'Save As' }).click();
  await expect(page.getByTestId('tab').filter({ hasText: 'mine.md' })).toHaveCount(1);
  expect(await read(page, '/docs/mine.md')).toBe('mine original\n');
  expect(await read(page, '/docs/file.md')).toBe('theirs\n');
});

test('a failed write keeps the file unsaved and recoverable, and offers Save As only', async ({ page }) => {
  await openFromDisk(page, '/docs/file.txt', 'data\n');
  await typeAtStart(page, 'Z');
  await settle(page);
  await fake(page, (c) => void (c.failWrite = 'disk full'));
  await page.keyboard.press('ControlOrMeta+S');
  await expect(dialog(page)).toContainText('disk full');
  await expect(dialog(page).getByRole('button', { name: 'Download' })).toHaveCount(0);
  await expectDirty(page);
  expect(await read(page, '/docs/file.txt')).toBe('data\n');
  expect(await idbRecords(page)).toHaveLength(1);

  await fake(page, (c) => void (c.failWrite = null));
  await nextSave(page, '/docs/elsewhere.txt');
  await dialog(page).getByRole('button', { name: 'Save As' }).click();
  await expectClean(page);
  expect(await read(page, '/docs/elsewhere.txt')).toBe('Zdata\n');
});

test('a file that has disappeared stops the save and offers Save As', async ({ page }) => {
  await openFromDisk(page, '/docs/gone.txt', 'data\n');
  await typeAtStart(page, 'Z');
  await fake(page, (c) => c.remove('/docs/gone.txt'));
  await page.keyboard.press('ControlOrMeta+S');
  await expect(dialog(page)).toContainText('no longer exists');
  await expect(dialog(page).getByRole('button', { name: 'Save As' })).toBeVisible();
  await expectDirty(page);
  expect(await read(page, '/docs/gone.txt')).toBeNull();
});

test('closing with unsaved changes: Save, then the record is removed', async ({ page }) => {
  await openFromDisk(page, '/docs/file.txt', 'data\n');
  await typeAtStart(page, 'Z');
  await page.keyboard.press('Alt+W');
  await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('empty')).toBeVisible();
  expect(await read(page, '/docs/file.txt')).toBe('Zdata\n');
  await expect.poll(async () => (await idbRecords(page)).length).toBe(0);
});

test.describe('after a restart', () => {
  const restored = async (page: Page) => {
    await openFromDisk(page, '/private/secret-folder/file.txt', 'data\n');
    await typeAtStart(page, 'Z');
    await settle(page);
    await page.reload();
    await expect(page.getByTestId('recovery-entry')).toContainText('file.txt');
  };

  test('the list shows the name but not where the file lives', async ({ page }) => {
    await restored(page);
    await expect(page.getByTestId('recovery-list')).not.toContainText('secret-folder');
  });

  test('a granted path saves back to the same file', async ({ page }) => {
    await restored(page);
    await page.getByTestId('recovery-entry').getByRole('button', { name: 'Restore' }).click();
    await expect(source(page)).toContainText('Zdata');
    await expectDirty(page);
    await page.keyboard.press('ControlOrMeta+S');
    await expectClean(page);
    expect(await read(page, '/private/secret-folder/file.txt')).toBe('Zdata\n');
  });

  test('a refused path writes nothing and offers Save As', async ({ page }) => {
    await restored(page);
    await fake(page, (c) => void (c.regrant = 'denied'));
    await page.getByTestId('recovery-entry').getByRole('button', { name: 'Restore' }).click();
    await expect(source(page)).toContainText('Zdata');
    await page.keyboard.press('ControlOrMeta+S');
    await expect(dialog(page).getByRole('button', { name: 'Save As' })).toBeVisible();
    await expectDirty(page);
    expect(await read(page, '/private/secret-folder/file.txt')).toBe('data\n');
    expect(await writes(page)).toEqual([]);
  });

  test('a copy goes through the save panel and leaves the record in place', async ({ page }) => {
    await restored(page);
    await nextSave(page, '/docs/copy.txt');
    await page.getByTestId('recovery-entry').getByRole('button', { name: 'Save a copy' }).click();
    await expect.poll(() => read(page, '/docs/copy.txt')).toBe('Zdata\n');
    await expect(page.getByTestId('recovery-entry')).toHaveCount(1);
  });
});

test('links open through the host, and only the safe kinds', async ({ page }) => {
  await openFromDisk(page, '/docs/links.md', '[good](https://example.test/a)\n\n[bad](javascript:alert)\n');
  await rendered(page).getByText('good').click();
  await expect.poll(() => fake(page, (c) => c.opened)).toEqual(['https://example.test/a']);
  await rendered(page).getByText('bad').click();
  await settle(page);
  expect(await fake(page, (c) => c.opened)).toEqual(['https://example.test/a']);
});

test.describe('closing everything, as quitting will', () => {
  const closeAll = (page: Page) =>
    page.evaluate(() => (window as unknown as { __ws: { closeAll(): Promise<boolean> } }).__ws.closeAll());

  test('Cancel stops there and reports it, with the files left open', async ({ page }) => {
    await openFromDisk(page, '/docs/a.txt', 'a\n');
    await typeAtStart(page, '1');
    await openFromDisk(page, '/docs/b.txt', 'b\n');
    const result = closeAll(page);
    await expect(dialog(page)).toContainText('a.txt');
    await expect(page.getByTestId('tab').filter({ hasText: 'a.txt' })).toHaveClass(/active/);
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    expect(await result).toBe(false);
    await expect(page.getByTestId('tab')).toHaveCount(2);
    await expectDirty(page);
  });

  test('each unsaved file gets its answer, then nothing is left to recover', async ({ page }) => {
    await openFromDisk(page, '/docs/a.txt', 'a\n');
    await typeAtStart(page, '1');
    await openFromDisk(page, '/docs/b.txt', 'b\n');
    await typeAtStart(page, '2');
    await openFromDisk(page, '/docs/c.txt', 'c\n');
    const result = closeAll(page);
    await expect(dialog(page)).toContainText('a.txt');
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toContainText('b.txt');
    await dialog(page).getByRole('button', { name: "Don't save" }).click();
    expect(await result).toBe(true);
    await expect(page.getByTestId('empty')).toBeVisible();
    expect(await read(page, '/docs/a.txt')).toBe('1a\n');
    expect(await read(page, '/docs/b.txt')).toBe('b\n');
    await expect.poll(async () => (await idbRecords(page)).length).toBe(0);
  });

  test('a failed save stops it, so the work stays open', async ({ page }) => {
    await openFromDisk(page, '/docs/a.txt', 'a\n');
    await typeAtStart(page, '1');
    await fake(page, (c) => void (c.failWrite = 'disk full'));
    const result = closeAll(page);
    await dialog(page).getByRole('button', { name: 'Save', exact: true }).click();
    await expect(dialog(page)).toContainText('disk full');
    await dialog(page).getByRole('button', { name: 'Cancel' }).click();
    expect(await result).toBe(false);
    await expect(page.getByTestId('tab')).toHaveCount(1);
    await expect.poll(async () => (await idbRecords(page)).length).toBe(1);
  });
});

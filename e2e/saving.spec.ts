import { expect, Page, test } from '@playwright/test';
import { downloadSaved, drop, expectClean, expectDirty, open, runCommand, settle, source, useDownloads } from './helpers';

/** Real FileSystemFileHandles, from the origin-private file system, behind stubbed pickers. */
async function stubPickers(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.showOpenFilePicker = async () => [await (await navigator.storage.getDirectory()).getFileHandle(w.__openName as string)];
    w.showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle(w.__saveName as string, { create: true });
  });
}

const writeOpfs = (page: Page, name: string, bytes: number[]) =>
  page.evaluate(
    async ({ name, bytes }) => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle(name, { create: true });
      const w = await handle.createWritable();
      await w.write(new Uint8Array(bytes));
      await w.close();
    },
    { name, bytes },
  );

const readOpfs = (page: Page, name: string) =>
  page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    const file = await (await root.getFileHandle(name)).getFile();
    return { bytes: Array.from(new Uint8Array(await file.arrayBuffer())), modified: file.lastModified };
  }, name);

const caretHome = async (page: Page) => {
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
};

const toBytes = (s: string) => Array.from(Buffer.from(s));

async function openFromDisk(page: Page, name: string, content: string) {
  await writeOpfs(page, name, toBytes(content));
  await page.evaluate((n) => ((window as unknown as Record<string, unknown>).__openName = n), name);
  await runCommand(page, 'Open file');
  await expect(page.getByTestId('tab').filter({ hasText: name })).toHaveCount(1);
}

test.describe('with the File System Access API (Chrome, Edge)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium');

  test.beforeEach(async ({ page }) => {
    await stubPickers(page);
    await page.goto('/');
  });

  test('AC11 Save overwrites the original file', async ({ page }) => {
    await openFromDisk(page, 'file.md', 'one\r\ntwo\r\n');
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('x');
    await expectDirty(page);
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page.getByTestId('notice-info')).toContainText('Saved file.md');
    await expectClean(page);
    expect((await readOpfs(page, 'file.md')).bytes).toEqual(toBytes('xone\r\ntwo\r\n'));
  });

  test('AC1 Save on an unedited file performs no write', async ({ page }) => {
    await openFromDisk(page, 'file.txt', 'same\n');
    const before = await readOpfs(page, 'file.txt');
    await page.waitForTimeout(20);
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page.getByTestId('notice-info')).toContainText('No changes');
    expect(await readOpfs(page, 'file.txt')).toEqual(before);
  });

  test('Save As writes to the chosen file, then Save goes there', async ({ page }) => {
    await openFromDisk(page, 'in.txt', 'hello\n');
    await page.evaluate(() => ((window as unknown as Record<string, unknown>).__saveName = 'out.txt'));
    await page.keyboard.press('ControlOrMeta+Shift+S');
    await expect(page.getByTestId('tab').filter({ hasText: 'out.txt' })).toHaveCount(1);
    expect((await readOpfs(page, 'out.txt')).bytes).toEqual(toBytes('hello\n'));
    await caretHome(page);
    await page.keyboard.type('Z');
    await page.keyboard.press('ControlOrMeta+S');
    await expectClean(page);
    expect((await readOpfs(page, 'out.txt')).bytes).toEqual(toBytes('Zhello\n'));
    expect((await readOpfs(page, 'in.txt')).bytes).toEqual(toBytes('hello\n'));
  });

  test('a file with no handle: first Save behaves like Save As', async ({ page }) => {
    await open(page, { name: 'dropped.txt', bytes: 'hi\n' });
    await page.evaluate(() => ((window as unknown as Record<string, unknown>).__saveName = 'dropped.txt'));
    await caretHome(page);
    await page.keyboard.type('Z');
    await page.keyboard.press('ControlOrMeta+S');
    await expectClean(page);
    expect((await readOpfs(page, 'dropped.txt')).bytes).toEqual(toBytes('Zhi\n'));
  });

  test('AC12 an external change triggers the prompt before anything is overwritten', async ({ page }) => {
    await openFromDisk(page, 'file.md', 'original\n');
    await caretHome(page);
    await page.keyboard.type('mine ');
    await writeOpfs(page, 'file.md', toBytes('theirs, longer text\n'));

    await page.keyboard.press('ControlOrMeta+S');
    const dialog = page.getByTestId('dialog');
    await expect(dialog).toContainText('changed outside');
    expect((await readOpfs(page, 'file.md')).bytes).toEqual(toBytes('theirs, longer text\n'));

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expectDirty(page);
    expect((await readOpfs(page, 'file.md')).bytes).toEqual(toBytes('theirs, longer text\n'));

    await page.keyboard.press('ControlOrMeta+S');
    await dialog.getByRole('button', { name: 'Overwrite' }).click();
    await expectClean(page);
    expect((await readOpfs(page, 'file.md')).bytes).toEqual(toBytes('mine original\n'));

    // Having saved, its own write isn't reported as an external change.
    await caretHome(page);
    await page.keyboard.type('more ');
    await page.keyboard.press('ControlOrMeta+S');
    await expectClean(page);
    await expect(dialog).toHaveCount(0);
  });

  test('a failed write keeps the file unsaved, keeps recovery data and offers a download', async ({ page }) => {
    await openFromDisk(page, 'file.txt', 'data\n');
    await caretHome(page);
    await page.keyboard.type('Z');
    await settle(page);
    await page.evaluate(() => {
      FileSystemFileHandle.prototype.createWritable = () => Promise.reject(new DOMException('disk full', 'QuotaExceededError'));
    });
    await page.keyboard.press('ControlOrMeta+S');
    const dialog = page.getByTestId('dialog');
    await expect(dialog).toContainText('disk full');
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download' }).click();
    await downloading;
    await expectDirty(page);
    const records = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const o = indexedDB.open('full');
          o.onsuccess = () => {
            const c = o.result.transaction('documents').objectStore('documents').count();
            c.onsuccess = () => resolve(c.result);
          };
        }),
    );
    expect(records).toBe(1);
  });

  test('closing with unsaved changes: Save, then the record is removed', async ({ page }) => {
    await openFromDisk(page, 'file.txt', 'data\n');
    await caretHome(page);
    await page.keyboard.type('Z');
    await page.keyboard.press('Alt+W');
    await page.getByTestId('dialog').getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('empty')).toBeVisible();
    expect((await readOpfs(page, 'file.txt')).bytes).toEqual(toBytes('Zdata\n'));
  });
});

test.describe('without the File System Access API', () => {
  test.beforeEach(async ({ page }) => {
    await useDownloads(page);
    await page.goto('/');
  });

  test('AC11 Save downloads a copy, labelled Download, with a one-time notice @cross', async ({ page }) => {
    await expect(page.getByTestId('browser-notice')).toBeVisible();
    await open(page, { name: 'a.txt', bytes: 'x\n' });
    await caretHome(page);
    await page.keyboard.type('Z');
    expect((await downloadSaved(page)).toString()).toBe('Zx\n');
    await expectClean(page);
    await page.getByTestId('menu-button').click();
    await expect(page.getByTestId('menu').getByRole('menuitem', { name: 'Download', exact: false }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByTestId('browser-notice').getByRole('button', { name: 'Dismiss' }).click();
    await page.reload();
    await page.getByTestId('empty').waitFor();
    await expect(page.getByTestId('browser-notice')).toHaveCount(0);
  });

  test('Save As asks for an editable file name @cross', async ({ page }) => {
    await open(page, { name: 'a.txt', bytes: 'x\n' });
    const downloading = page.waitForEvent('download');
    await page.keyboard.press('ControlOrMeta+Shift+S');
    const dialog = page.getByTestId('dialog');
    await dialog.getByRole('textbox').fill('renamed.txt');
    await dialog.getByRole('button', { name: 'Download' }).click();
    expect((await downloading).suggestedFilename()).toBe('renamed.txt');
  });

  test('AC13 a character the encoding lacks stops the save, with no silent replacement @cross', async ({ page }) => {
    const original = Buffer.from('caf\xe9\r\n', 'latin1');
    await open(page, { name: 'a.txt', bytes: original });
    await expect(page.getByTestId('status-encoding')).toHaveText('Windows-1252');
    await caretHome(page);
    await page.keyboard.type('→');
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.keyboard.press('ControlOrMeta+S');
    const dialog = page.getByTestId('dialog');
    await expect(dialog).toContainText('Windows-1252');
    await expect(dialog).toContainText('→');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await settle(page);
    expect(downloads).toBe(0);
    await expectDirty(page);

    const downloading = page.waitForEvent('download');
    await page.keyboard.press('ControlOrMeta+S');
    await dialog.getByRole('button', { name: 'Save as UTF-8' }).click();
    const { readFileSync } = await import('node:fs');
    const saved = readFileSync(await (await downloading).path());
    expect(saved.toString('utf8')).toBe('→café\r\n');
    await expect(page.getByTestId('status-encoding')).toHaveText('UTF-8');
    await expectClean(page);
  });
});

test.describe('opening', () => {
  test.beforeEach(async ({ page }) => {
    await useDownloads(page);
    await page.goto('/');
  });

  test('unsupported files show an error naming them, and others in the drop still open @cross', async ({ page }) => {
    await drop(page, { name: 'photo.png', bytes: 'x' }, { name: 'ok.csv', bytes: 'a,b\n' }, { name: 'UPPER.MD', bytes: '# x\n' });
    await expect(page.getByTestId('notice-error')).toContainText('photo.png');
    await expect(page.getByTestId('tab')).toHaveCount(2);
  });

  test('the same file opened twice focuses its tab', async ({ page }) => {
    await open(page, { name: 'a.txt', bytes: 'x\n' });
    await open(page, { name: 'b.txt', bytes: 'y\n' });
    await drop(page, { name: 'a.txt', bytes: 'x\n' });
    await expect(page.getByTestId('tab').filter({ hasText: 'a.txt' })).toHaveClass(/active/);
    await expect(page.getByTestId('tab')).toHaveCount(2);
  });

  test('the Open button uses a file input without the picker API @cross', async ({ page }) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('empty').getByRole('button', { name: 'Open file' }).click();
    await (await chooser).setFiles({ name: 'pick.txt', mimeType: 'text/plain', buffer: Buffer.from('picked\n') });
    await expect(source(page)).toContainText('picked');
  });

  test('closing a file with unsaved changes offers Save, Don’t save and Cancel @cross', async ({ page }) => {
    await open(page, { name: 'a.txt', bytes: 'x\n' });
    await caretHome(page);
    await page.keyboard.type('Z');
    await page.keyboard.press('Alt+W');
    const dialog = page.getByTestId('dialog');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('tab')).toHaveCount(1);
    await page.keyboard.press('Alt+W');
    await dialog.getByRole('button', { name: "Don't save" }).click();
    await expect(page.getByTestId('empty')).toBeVisible();
  });
});

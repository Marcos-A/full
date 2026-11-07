import { chromium, expect, Page, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadSaved, expectDirty, idbRecords, open, settle, source, sourceText, useDownloads } from './helpers';

const entries = (page: Page) => page.getByTestId('recovery-entry');

async function leaveFile(page: Page, name: string, edit?: string): Promise<void> {
  await page.goto('/');
  await open(page, { name, bytes: 'content\n', lastModified: 1_700_000_000_000 + name.length });
  if (edit) {
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type(edit);
    await settle(page);
  } else {
    await expect.poll(async () => (await idbRecords(page)).some((r) => r.name === name)).toBe(true);
  }
}

test('AC14 the file is listed and restored after the browser process is killed', async ({ browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'Process kill uses a persistent Chromium profile');
  const profile = mkdtempSync(join(tmpdir(), 'full-kill-'));
  const launch = () => chromium.launchPersistentContext(profile, { baseURL: baseURL! });

  let context = await launch();
  let page = context.pages()[0] ?? (await context.newPage());
  await useDownloads(page);
  await page.goto('/');
  await open(page, { name: 'crash.md', bytes: 'before\r\n' });
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('after crash');
  // Pause for under 2 seconds, then kill every process of this profile without warning.
  await page.waitForTimeout(1200);
  // The bracket stops the pattern from matching this shell's own command line.
  execSync(`pkill -9 -f '[${profile[0]}]${profile.slice(1)}' || true`);
  await context.close().catch(() => undefined);

  context = await launch();
  page = context.pages()[0] ?? (await context.newPage());
  await useDownloads(page);
  await page.goto('/');
  await expect(entries(page)).toHaveCount(1);
  await expect(entries(page)).toContainText('crash.md');
  await expect(entries(page)).toContainText('unsaved changes');
  await entries(page).getByRole('button', { name: 'Restore' }).click();
  await expect(source(page)).toContainText('after crash');
  await expectDirty(page);
  expect((await downloadSaved(page)).toString()).toBe('before\r\nafter crash');
  await context.close();
});

test('a record saved by an earlier version still restores and overwrites its file', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Needs the File System Access API');
  await page.goto('/');
  await page.getByTestId('empty').waitFor();
  // Written field by field, as the version before the desktop work stored it.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getFileHandle('old.txt', { create: true });
    const writable = await handle.createWritable();
    await writable.write('before\n');
    await writable.close();
    const file = await handle.getFile();
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('full');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const tx = open.result.transaction('documents', 'readwrite');
        tx.objectStore('documents').put({
          id: 'old-record',
          sessionId: 'a-session-long-gone',
          name: 'old.txt',
          kind: 'text',
          handle,
          originalBytes: new TextEncoder().encode('before\n').buffer,
          currentText: 'edited\n',
          lastSavedText: 'before\n',
          hasUnsavedChanges: true,
          encoding: 'utf-8',
          hasBom: false,
          lineEnding: 'lf',
          fileSize: file.size,
          fileLastModified: file.lastModified,
          updatedAt: Date.now(),
        });
        tx.oncomplete = () => {
          open.result.close();
          resolve();
        };
      };
    });
  });
  await page.reload();
  await entries(page).getByRole('button', { name: 'Restore' }).click();
  await expect(source(page)).toContainText('edited');
  await page.keyboard.press('ControlOrMeta+S');
  await expect(page.getByTestId('notice-info')).toContainText('Saved old.txt');
  const saved = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    return (await (await root.getFileHandle('old.txt')).getFile()).text();
  });
  expect(saved).toBe('edited\n');
});

test('AC14 a reload offers the file instead of reopening it automatically @cross', async ({ page }) => {
  await leaveFile(page, 'r.txt', 'typed');
  await page.reload();
  await expect(entries(page)).toHaveCount(1);
  await expect(page.getByTestId('tab')).toHaveCount(0);
  await entries(page).getByRole('button', { name: 'Restore' }).click();
  await expect(source(page)).toContainText('typedcontent');
  await expect(page.getByTestId('dirty')).toHaveCount(1);
  expect(await sourceText(page)).toBe('typedcontent\n');
});

test('a clean file left open is also recoverable, and restores without unsaved changes', async ({ page }) => {
  await leaveFile(page, 'clean.txt');
  await page.reload();
  await expect(entries(page)).toContainText('no unsaved changes');
  await entries(page).getByRole('button', { name: 'Restore' }).click();
  await expect(source(page)).toContainText('content');
  await expect(page.getByTestId('dirty')).toHaveCount(0);
});

test('a restored CSV keeps its delimiter override and encoding', async ({ page }) => {
  await page.goto('/');
  await open(page, { name: 'a.csv', bytes: Buffer.from('à,b;c\n', 'latin1') });
  await page.keyboard.press('ControlOrMeta+K');
  await page.getByTestId('palette').getByRole('combobox').fill('CSV delimiter: comma');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('status-delimiter')).toHaveText('comma');
  await settle(page);
  await page.reload();
  await entries(page).getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByTestId('status-delimiter')).toHaveText('comma');
  await expect(page.getByTestId('status-encoding')).toHaveText('Windows-1252');
});

test('AC15 a file closed normally does not appear @cross', async ({ page }) => {
  await leaveFile(page, 'closed.txt');
  await page.keyboard.press('Alt+W');
  await expect(page.getByTestId('empty')).toBeVisible();
  await expect.poll(() => idbRecords(page)).toEqual([]);
  await page.reload();
  await page.getByTestId('empty').waitFor();
  await settle(page);
  await expect(entries(page)).toHaveCount(0);
});

test('AC16 a file open in another tab is not listed until that tab closes @cross', async ({ context }) => {
  const first = await context.newPage();
  await first.goto('/');
  await first.getByTestId('empty').waitFor();
  const second = await context.newPage();
  await second.goto('/');
  await open(second, { name: 'other.txt', bytes: 'x\n' });
  await expect.poll(async () => (await idbRecords(first)).length).toBe(1);
  await first.bringToFront();
  await first.waitForTimeout(800);
  await first.evaluate(() => window.dispatchEvent(new Event('focus')));
  await first.waitForTimeout(300);
  await expect(entries(first)).toHaveCount(0);
  await second.close();
  await expect(entries(first)).toHaveCount(1, { timeout: 8000 });
  await expect(entries(first)).toContainText('other.txt');
});

test('AC17 two tabs restoring the same record end with one owner @cross', async ({ context }) => {
  const victim = await context.newPage();
  await leaveFile(victim, 'contested.txt', 'edit');
  await victim.close();

  const [a, b] = [await context.newPage(), await context.newPage()];
  await Promise.all([a.goto('/'), b.goto('/')]);
  await expect(entries(a)).toHaveCount(1);
  await expect(entries(b)).toHaveCount(1);
  await Promise.all([
    a.evaluate(() => (document.querySelector('[data-testid=recovery-entry] button') as HTMLElement).click()),
    b.evaluate(() => (document.querySelector('[data-testid=recovery-entry] button') as HTMLElement).click()),
  ]);
  await expect
    .poll(async () => (await a.getByTestId('tab').count()) + (await b.getByTestId('tab').count()))
    .toBe(1);
  await settle(a);
  expect((await a.getByTestId('tab').count()) + (await b.getByTestId('tab').count())).toBe(1);
  const records = await idbRecords(a);
  expect(records).toHaveLength(1);
});

test('AC18 after 12 abrupt closes, 10 remain, by the eviction rule', async ({ context }) => {
  // Three unsaved files that are the oldest, then nine clean files.
  const names: string[] = [];
  for (let i = 0; i < 12; i++) {
    const page = await context.newPage();
    const name = `file${String(i).padStart(2, '0')}.txt`;
    names.push(name);
    await leaveFile(page, name, i < 3 ? 'unsaved ' : undefined);
    await page.close();
  }
  const page = await context.newPage();
  await page.goto('/');
  await expect(entries(page)).toHaveCount(10, { timeout: 10_000 });
  const listed = await entries(page).locator('.recovery-name').allTextContents();
  // The two oldest clean files go first, even though the unsaved ones are older.
  expect(listed.sort()).toEqual(names.filter((n) => n !== 'file03.txt' && n !== 'file04.txt').sort());
  await expect.poll(async () => (await idbRecords(page)).length).toBe(10);
});

test('AC19 discard and Clear all remove data from IndexedDB @cross', async ({ context }) => {
  for (const [name, edit] of [['a.txt', 'x'], ['b.txt', 'y'], ['c.txt', undefined]] as const) {
    const leaving = await context.newPage();
    await leaveFile(leaving, name, edit);
    await leaving.close();
  }
  const page = await context.newPage();
  await page.goto('/');
  await expect(entries(page)).toHaveCount(3);

  const clean = entries(page).filter({ hasText: 'c.txt' });
  await clean.getByRole('button', { name: 'Discard' }).click();
  await expect(entries(page)).toHaveCount(2);
  expect((await idbRecords(page)).map((r) => r.name).sort()).toEqual(['a.txt', 'b.txt']);

  const unsaved = entries(page).filter({ hasText: 'a.txt' });
  await unsaved.getByRole('button', { name: 'Discard' }).click();
  await page.getByTestId('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(entries(page)).toHaveCount(2);
  await unsaved.getByRole('button', { name: 'Discard' }).click();
  await page.getByTestId('dialog').getByRole('button', { name: 'Discard' }).click();
  await expect(entries(page)).toHaveCount(1);

  await page.getByRole('button', { name: 'Clear all recovery data' }).click();
  await page.getByTestId('dialog').getByRole('button', { name: 'Clear all recovery data' }).click();
  await expect(entries(page)).toHaveCount(0);
  await expect.poll(() => idbRecords(page)).toEqual([]);
});

test('Restore all, banner when files are open, Download copy', async ({ context }) => {
  for (const name of ['a.txt', 'b.txt']) {
    const leaving = await context.newPage();
    await leaveFile(leaving, name, 'edit ');
    await leaving.close();
  }
  const page = await context.newPage();
  await useDownloads(page);
  await page.goto('/');
  await expect(entries(page)).toHaveCount(2);
  const downloading = page.waitForEvent('download');
  await entries(page).first().getByRole('button', { name: 'Download copy' }).click();
  expect((await downloading).suggestedFilename()).toMatch(/[ab]\.txt/);

  await open(page, { name: 'now.txt', bytes: 'x\n' });
  const banner = page.getByTestId('recovery-banner');
  await expect(banner).toContainText('2 files');
  await banner.getByRole('button', { name: 'Review' }).click();
  await page.getByTestId('recovery-dialog').getByRole('button', { name: 'Restore all' }).click();
  await expect(page.getByTestId('tab')).toHaveCount(3);
  await expect(banner).toHaveCount(0);
  await expect(page.getByTestId('recovery-dialog')).toHaveCount(0);
});

test('a quota failure shows a persistent warning', async ({ page }) => {
  await page.addInitScript(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  await page.goto('/');
  await open(page, { name: 'a.txt', bytes: 'x\n' });
  await expect(page.getByTestId('storage-warning')).toBeVisible();
});

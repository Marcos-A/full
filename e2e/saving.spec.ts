import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { cell, downloadSaved, drop, expectClean, expectDirty, nextFileChooser, open, rendered, runCommand, settle, source, sourceText, useDownloads } from './helpers';

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
    await expect(dialog.getByRole('button')).toHaveText(['Cancel', 'Save As', 'Overwrite']);
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

  // The browser reports 'prompt' when the write request arrives too long after the click.
  const stubPermission = (page: Page, answers: string[]) =>
    page.evaluate((answers) => {
      const w = window as unknown as Record<string, unknown>;
      const activeDuringRequest: boolean[] = [];
      w.__activeDuringRequest = activeDuringRequest;
      let granted = false;
      FileSystemHandle.prototype.queryPermission = async () => (granted ? 'granted' : 'prompt');
      FileSystemHandle.prototype.requestPermission = async () => {
        activeDuringRequest.push(navigator.userActivation.isActive);
        const answer = answers.shift() as PermissionState;
        granted = answer === 'granted';
        return answer;
      };
    }, answers);

  test('an undecided permission asks for a fresh click, then saves', async ({ page }) => {
    await openFromDisk(page, 'file.txt', 'data\n');
    await caretHome(page);
    await page.keyboard.type('Z');
    await stubPermission(page, ['prompt', 'granted']);
    await page.keyboard.press('ControlOrMeta+S');
    const dialog = page.getByTestId('dialog');
    await expect(dialog).toContainText('one more confirmation');
    expect((await readOpfs(page, 'file.txt')).bytes).toEqual(toBytes('data\n'));
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expectClean(page);
    expect((await readOpfs(page, 'file.txt')).bytes).toEqual(toBytes('Zdata\n'));
    const active = await page.evaluate(() => (window as unknown as { __activeDuringRequest: boolean[] }).__activeDuringRequest);
    expect(active).toHaveLength(2);
    expect(active[1]).toBe(true);
    // Permission now holds, so another save doesn't ask again.
    await caretHome(page);
    await page.keyboard.type('Y');
    await page.keyboard.press('ControlOrMeta+S');
    await expectClean(page);
    await expect(dialog).toHaveCount(0);
  });

  test('cancelling that confirmation writes nothing and keeps the file unsaved', async ({ page }) => {
    await openFromDisk(page, 'file.txt', 'data\n');
    await caretHome(page);
    await page.keyboard.type('Z');
    await stubPermission(page, ['prompt']);
    await page.keyboard.press('ControlOrMeta+S');
    await page.getByTestId('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expectDirty(page);
    expect((await readOpfs(page, 'file.txt')).bytes).toEqual(toBytes('data\n'));
  });

  test('a refused permission offers Save As and Download, and writes nothing', async ({ page }) => {
    await openFromDisk(page, 'file.txt', 'data\n');
    await caretHome(page);
    await page.keyboard.type('Z');
    await stubPermission(page, ['denied']);
    await page.keyboard.press('ControlOrMeta+S');
    const dialog = page.getByTestId('dialog');
    await expect(dialog).toContainText('Permission denied');
    await expect(dialog.getByRole('button', { name: 'Save As' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Download' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expectDirty(page);
    expect((await readOpfs(page, 'file.txt')).bytes).toEqual(toBytes('data\n'));
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

  const PNG_START = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);

  test('binary files show an error naming them, and others in the drop still open @cross', async ({ page }) => {
    await drop(page, { name: 'photo.png', bytes: PNG_START }, { name: 'ok.csv', bytes: 'a,b\n' }, { name: 'UPPER.MD', bytes: '# x\n' });
    await expect(page.getByTestId('notice-error')).toContainText("photo.png\" can't be opened because it isn't a text file");
    await expect(page.getByTestId('tab')).toHaveCount(2);
  });

  test('a file with no extension or an unfamiliar one opens as plain text @cross', async ({ page }) => {
    await open(page, { name: 'notes', bytes: 'hello\n' });
    await expect(page.getByTestId('status-kind')).toHaveText('Text');
    await expect(source(page)).toContainText('hello');
    await expectClean(page);
    await open(page, { name: 'script.py', bytes: 'print(1)\n' });
    await expect(page.getByTestId('status-kind')).toHaveText('Text');
    await expect(source(page)).toContainText('print(1)');
    await open(page, { name: 'blank', bytes: '' });
    await expect(page.getByTestId('tab')).toHaveCount(3);
    await expect(page.getByTestId('notice-error')).toHaveCount(0);
  });

  test('a UTF-16 file with no extension is text, despite its NUL bytes', async ({ page }) => {
    await open(page, { name: 'wide', bytes: Buffer.from('\ufeffhi', 'utf16le') });
    await expect(source(page)).toContainText('hi');
    await expect(page.getByTestId('status-encoding')).toContainText('UTF-16');
  });

  test('a file with a known type is not second-guessed for containing a NUL byte', async ({ page }) => {
    await open(page, { name: 'odd.txt', bytes: Buffer.from([0x61, 0, 0x62]) });
    await expect(page.getByTestId('notice-error')).toHaveCount(0);
  });

  test('a file opened without a type takes one when saved under a name that gives it', async ({ page }) => {
    await open(page, { name: 'notes', bytes: '# Hi\n' });
    await expect(page.getByTestId('status-kind')).toHaveText('Text');
    await page.keyboard.press('ControlOrMeta+Shift+S');
    const dialog = page.getByTestId('dialog');
    await dialog.getByRole('textbox').fill('notes.md');
    await dialog.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(page.getByTestId('status-kind')).toHaveText('Markdown');
    await expect(rendered(page).locator('h1')).toHaveText('Hi');
  });

  test('the Open dialog does not hide files by type @cross', async ({ page }) => {
    const chooser = nextFileChooser(page);
    await page.reload();
    await page.getByTestId('empty').getByRole('button', { name: 'Open file' }).click();
    expect(await (await chooser).element().getAttribute('accept')).toBeNull();
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

test.describe('new files', () => {
  test.beforeEach(async ({ page }) => {
    await useDownloads(page);
    await page.goto('/');
  });

  const NEW_COMMANDS = { Markdown: 'New Markdown file', CSV: 'New CSV file', Text: 'New text file' };

  const create = async (page: Page, type: keyof typeof NEW_COMMANDS = 'Markdown') => {
    await runCommand(page, NEW_COMMANDS[type]);
    await expect(page.getByTestId('status-kind')).toHaveText(type);
  };

  const newDraft = async (page: Page) => {
    await page.getByTestId('empty').getByRole('button', { name: 'New file' }).click();
    await expect(page.getByTestId('tab')).toHaveCount(1);
  };

  /** Save a file that has no name yet, giving it this one. */
  const downloadNamed = async (page: Page, name: string, shortcut = 'ControlOrMeta+S') => {
    const downloading = page.waitForEvent('download');
    await page.keyboard.press(shortcut);
    const dialog = page.getByTestId('dialog');
    await dialog.getByRole('textbox').fill(name);
    await dialog.getByRole('button', { name: 'Download', exact: true }).click();
    return downloading;
  };

  const askedName = async (page: Page, name: string) => {
    await page.keyboard.press('ControlOrMeta+S');
    const dialog = page.getByTestId('dialog');
    await dialog.getByRole('textbox').fill(name);
    await dialog.getByRole('button', { name: 'Download', exact: true }).click();
    await expect(dialog).toContainText('without an extension');
    return dialog;
  };

  test('New file opens a blank draft straight away, with no name or type to choose @cross', async ({ page }) => {
    await newDraft(page);
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    await expect(page.getByTestId('tab')).toHaveText('untitled×');
    await expect(page.getByTestId('status-kind')).toHaveText('Text');
    await expectClean(page);
    await expect(source(page)).toBeFocused();
    await page.keyboard.type('a quick note');
    await expect(source(page)).toContainText('a quick note');
    await expectDirty(page);
  });

  test('the + menu has a blank draft too, and the next one gets its own name @cross', async ({ page }) => {
    await newDraft(page);
    await page.getByTestId('start-menu-button').click();
    await page.getByTestId('start-menu').getByRole('menuitem', { name: 'New file' }).click();
    await expect(page.getByTestId('tab')).toHaveCount(2);
    await expect(page.getByTestId('tab').filter({ hasText: 'untitled-2' })).toHaveCount(1);
    await expect(source(page)).toBeFocused();
  });

  test('a draft closed with nothing typed goes away without asking', async ({ page }) => {
    await newDraft(page);
    await page.keyboard.press('Alt+W');
    await expect(page.getByTestId('empty')).toBeVisible();
    await expect(page.getByTestId('dialog')).toHaveCount(0);
  });

  test('a draft can be discarded when closing', async ({ page }) => {
    await newDraft(page);
    await page.keyboard.type('temporary');
    await page.keyboard.press('Alt+W');
    const dialog = page.getByTestId('dialog');
    await expect(dialog).toContainText('Save changes to "untitled"?');
    await dialog.getByRole('button', { name: "Don't save" }).click();
    await expect(page.getByTestId('empty')).toBeVisible();
    await settle(page);
    await page.reload();
    await page.getByTestId('empty').waitFor();
    await expect(page.getByTestId('recovery-entry')).toHaveCount(0);
  });

  test('saving a draft asks for its name, and the extension sets its type @cross', async ({ page }) => {
    await newDraft(page);
    await page.keyboard.type('# Hi');
    const download = await downloadNamed(page, 'plan.md');
    expect(download.suggestedFilename()).toBe('plan.md');
    expect(readFileSync(await download.path()).toString()).toBe('# Hi');
    await expect(page.getByTestId('tab')).toContainText('plan.md');
    await expect(page.getByTestId('status-kind')).toHaveText('Markdown');
    await expect(rendered(page).locator('h1')).toHaveText('Hi');
    await expectClean(page);
    await expect(source(page)).toContainText('# Hi');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    // It has a name now, so the next save doesn't ask again.
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('!');
    expect((await downloadSaved(page)).toString()).toBe('# Hi!');
  });

  test('a draft saved as CSV becomes a table', async ({ page }) => {
    await newDraft(page);
    await page.keyboard.type('a,b\n1,2\n');
    await downloadNamed(page, 'data.csv');
    await expect(page.getByTestId('grid')).toBeVisible();
    await expect(page.getByTestId('status-counts')).toHaveText('2 rows × 2 columns');
    await expect(cell(page, 1, 1)).toHaveText('2');
    await expectClean(page);
  });

  test('a blank draft can be saved as CSV', async ({ page }) => {
    await newDraft(page);
    await downloadNamed(page, 'empty.csv');
    await expect(page.getByTestId('status-kind')).toHaveText('CSV');
    await expectClean(page);
  });

  test('a draft saved as text stays as it is', async ({ page }) => {
    await newDraft(page);
    await page.keyboard.type('note');
    await downloadNamed(page, 'note.txt');
    await expect(page.getByTestId('status-kind')).toHaveText('Text');
    await expect(source(page)).toContainText('note');
    await expectClean(page);
  });

  test('Save As does not change the type of a file that already has one', async ({ page }) => {
    await create(page, 'Markdown');
    await page.keyboard.type('# Hi');
    await downloadNamed(page, 'notes.txt', 'ControlOrMeta+Shift+S');
    await expect(page.getByTestId('tab')).toContainText('notes.txt');
    await expect(page.getByTestId('status-kind')).toHaveText('Markdown');
  });

  test('no extension warns, can go ahead, and Cancel saves nothing @cross', async ({ page }) => {
    await newDraft(page);
    await page.keyboard.type('note');
    const dialog = await askedName(page, 'note');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expectDirty(page);
    await expect(page.getByTestId('tab')).toContainText('untitled');

    const again = await askedName(page, 'note');
    const downloading = page.waitForEvent('download');
    await again.getByRole('button', { name: 'Save without extension' }).click();
    expect((await downloading).suggestedFilename()).toBe('note');
    await expect(page.getByTestId('status-kind')).toHaveText('Text');
    await expectClean(page);
  });

  test('a name with an unfamiliar extension is left to the user, without a warning', async ({ page }) => {
    await newDraft(page);
    await page.keyboard.type('print(1)');
    const download = await downloadNamed(page, 'script.py');
    expect(download.suggestedFilename()).toBe('script.py');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    await expect(page.getByTestId('status-kind')).toHaveText('Text');
  });

  test('the warning goes away for good only when it was told to while going ahead', async ({ page }) => {
    await newDraft(page);
    await page.keyboard.type('one');
    const cancelled = await askedName(page, 'one');
    await cancelled.getByRole('checkbox', { name: "Don't show this again" }).check();
    await cancelled.getByRole('button', { name: 'Cancel' }).click();

    const dialog = await askedName(page, 'one');
    await dialog.getByRole('checkbox', { name: "Don't show this again" }).check();
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Save without extension' }).click();
    await downloading;

    await page.reload();
    await newDraft(page);
    await page.keyboard.type('two');
    const download = await downloadNamed(page, 'two');
    expect(download.suggestedFilename()).toBe('two');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
  });

  test('each type gets its ending and its editor, with nothing to answer @cross', async ({ page }) => {
    await create(page, 'Text');
    await expect(page.getByTestId('tab').filter({ hasText: 'untitled.txt' })).toHaveCount(1);
    await create(page, 'CSV');
    await expect(page.getByTestId('tab').filter({ hasText: 'untitled-2.csv' })).toHaveCount(1);
    await expect(page.getByTestId('grid')).toBeVisible();
    await create(page, 'Markdown');
    await expect(page.getByTestId('tab').filter({ hasText: 'untitled-3.md' })).toHaveCount(1);
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    await expect(source(page)).toBeFocused();
    await page.keyboard.type('# Hi');
    await expect(rendered(page).locator('h1')).toHaveText('Hi');
    await expectDirty(page);
    expect((await downloadSaved(page, true)).toString()).toBe('# Hi');
    await expectClean(page);
  });

  test('a new Markdown file has no reformatting warning, even after saving mid-edit @cross', async ({ page }) => {
    await create(page);
    await rendered(page).click();
    await page.keyboard.type('Hello');
    await expect.poll(() => sourceText(page)).toBe('Hello');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    expect((await downloadSaved(page, true)).toString()).toBe('Hello');
    await rendered(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type(' again');
    await expect.poll(() => sourceText(page)).toBe('Hello again');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
  });

  test('text typed in the source of a new file gets no warning either', async ({ page }) => {
    await create(page);
    await page.keyboard.type('* item');
    await expect(rendered(page).locator('li')).toHaveText('item');
    await rendered(page).locator('li').click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await expect.poll(() => sourceText(page)).toContain('item!');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
  });

  test('once a new file is saved, the warning protects it like any other', async ({ page }) => {
    await create(page);
    await page.keyboard.type('* item __bold__');
    await downloadSaved(page, true);
    await rendered(page).locator('strong').waitFor();
    await rendered(page).locator('strong').click();
    await page.keyboard.type('x');
    const dialog = page.getByTestId('dialog');
    await expect(dialog).toContainText('may reformat');
    await dialog.getByRole('button', { name: 'Edit source instead' }).click();
    expect(await sourceText(page)).toBe('* item __bold__');
    await expectClean(page);
  });

  test('an empty file that already exists has no warning, and one with text does', async ({ page }) => {
    await open(page, { name: 'empty.md', bytes: '' });
    await rendered(page).click();
    await page.keyboard.type('A');
    await expect.poll(() => sourceText(page)).toBe('A');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    await open(page, { name: 'full.md', bytes: 'text\n' });
    await rendered(page).getByText('text').click();
    await page.keyboard.type('B');
    await expect(page.getByTestId('dialog')).toBeVisible();
  });

  test('a new CSV opens as a table to type into, ready for Excel', async ({ page }) => {
    await create(page, 'CSV');
    await expect(page.getByTestId('status-delimiter')).toHaveText('comma');
    await expect(page.getByTestId('status-counts')).toHaveText('2 rows × 3 columns');
    await expect(page.getByTestId('status-encoding')).toHaveText('UTF-8 BOM');
    await page.getByTestId('grid').focus();
    await cell(page, 0, 0).click();
    await page.keyboard.type('nom');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Núria');
    await page.keyboard.press('Enter');
    const saved = await downloadSaved(page, true);
    expect(saved.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(saved.subarray(3).toString()).toBe('nom,,\r\nNúria,,\r\n');
  });

  test.describe('in a locale with decimal commas', () => {
    test.use({ locale: 'ca-ES' });
    test('a new CSV uses semicolons', async ({ page }) => {
      await runCommand(page, 'Fitxer CSV nou');
      await expect(page.getByTestId('status-delimiter')).toHaveText('punt i coma');
      await expect(page.getByTestId('status-counts')).toHaveText('2 files × 3 columnes');
    });
  });

  test('saving a blank new file writes it, instead of saying there is nothing to save', async ({ page }) => {
    await create(page);
    expect((await downloadSaved(page, true)).length).toBe(0);
  });

  test('an untouched new file leaves nothing to recover; a typed one can be restored', async ({ page }) => {
    await newDraft(page);
    await settle(page);
    await page.reload();
    await page.getByTestId('empty').waitFor();
    await settle(page);
    await expect(page.getByTestId('recovery-entry')).toHaveCount(0);

    await newDraft(page);
    await page.keyboard.type('keep me');
    await settle(page);
    await page.reload();
    const entry = page.getByTestId('recovery-entry');
    await expect(entry).toContainText('untitled');
    await entry.getByRole('button', { name: 'Restore' }).click();
    await expect(source(page)).toContainText('keep me');
    await expectDirty(page);
    const download = await downloadNamed(page, 'kept.txt');
    expect(readFileSync(await download.path()).toString()).toBe('keep me');
  });

  test('on the restore screen, a new or opened file leaves pending files in place @cross', async ({ page }) => {
    await open(page, { name: 'pending.txt', bytes: 'x\n' });
    await source(page).click();
    await page.keyboard.type('edit');
    await settle(page);
    await page.reload();
    const entry = page.getByTestId('recovery-entry');
    await expect(entry).toHaveCount(1);
    await expect(page.getByTestId('recovery-list')).toContainText('stay here until you restore or discard');

    await create(page, 'Markdown');
    await expect(page.getByTestId('recovery-banner')).toContainText('1 file');
    const chooser = page.waitForEvent('filechooser');
    await page.getByTestId('start-menu-button').click();
    await page.getByTestId('start-menu').getByRole('menuitem', { name: 'Open file' }).click();
    await (await chooser).setFiles({ name: 'picked.txt', mimeType: 'text/plain', buffer: Buffer.from('p\n') });
    await expect(page.getByTestId('tab')).toHaveCount(2);

    await page.keyboard.press('Alt+W');
    await runCommand(page, 'Close file');
    await expect(page.getByTestId('empty')).toBeVisible();
    await expect(entry).toContainText('pending.txt');
    await entry.getByRole('button', { name: 'Restore' }).click();
    await expect(source(page)).toContainText('edit');
  });
});

test.describe('new files with the file picker', () => {
  const setSaveName = (page: Page, name: string) =>
    page.evaluate((name) => ((window as unknown as Record<string, unknown>).__saveName = name), name);

  const opfsNames = (page: Page) =>
    page.evaluate(async () => {
      const names: string[] = [];
      for await (const name of (await navigator.storage.getDirectory()).keys()) names.push(name);
      return names;
    });

  test.beforeEach(async ({ page }) => {
    await stubPickers(page);
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, (options: unknown) => unknown> & { __pickerOptions?: unknown };
      const stubbed = w.showSaveFilePicker;
      w.showSaveFilePicker = (options) => {
        w.__pickerOptions = options;
        return stubbed(options);
      };
    });
    await page.goto('/');
    await page.getByTestId('empty').getByRole('button', { name: 'New file' }).click();
    await page.keyboard.type('note');
  });

  test('a draft offers no filter, so that the name stays as typed, and takes its type from it', async ({ page }) => {
    await setSaveName(page, 'plan.md');
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page.getByTestId('tab')).toContainText('plan.md');
    const options = await page.evaluate(() => (window as unknown as Record<string, unknown>).__pickerOptions as Record<string, unknown>);
    expect(options.suggestedName).toBe('untitled');
    expect(options.types).toBeUndefined();
    await expect(page.getByTestId('status-kind')).toHaveText('Markdown');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
  });

  test('backing out of the warning leaves no empty file behind', async ({ page }) => {
    await setSaveName(page, 'note');
    await page.keyboard.press('ControlOrMeta+S');
    const dialog = page.getByTestId('dialog');
    await expect(dialog).toContainText('Save "note" without an extension?');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => opfsNames(page)).not.toContain('note');
    await expectDirty(page);
  });

  test('going ahead writes the file and keeps its name', async ({ page }) => {
    await setSaveName(page, 'note');
    await page.keyboard.press('ControlOrMeta+S');
    const dialog = page.getByTestId('dialog');
    await dialog.getByRole('button', { name: 'Save without extension' }).click();
    await expectClean(page);
    await expect(page.getByTestId('tab')).toContainText('note');
    expect((await readOpfs(page, 'note')).bytes).toEqual(toBytes('note'));
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page.getByTestId('notice-info').filter({ hasText: 'No changes' })).toHaveCount(1);
    await expect(dialog).toHaveCount(0);
  });
});

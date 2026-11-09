import { expect, FileChooser, Locator, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

export interface TestFile {
  name: string;
  bytes: Buffer | Uint8Array | string;
  lastModified?: number;
}

const encoded = (file: TestFile) => ({
  name: file.name,
  lastModified: file.lastModified ?? 1_700_000_000_000,
  data: Array.from(typeof file.bytes === 'string' ? Buffer.from(file.bytes, 'utf8') : file.bytes),
});

/** Dispatch a real drop event carrying File objects. */
export async function drop(page: Page, ...files: TestFile[]): Promise<void> {
  await page.waitForFunction(() => document.querySelector('.statusbar') !== null);
  await page.evaluate((list) => {
    const transfer = new DataTransfer();
    for (const f of list) {
      transfer.items.add(new File([new Uint8Array(f.data)], f.name, { lastModified: f.lastModified }));
    }
    window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, files.map(encoded));
}

export async function open(page: Page, file: TestFile): Promise<void> {
  const before = await page.getByTestId('tab').count();
  await drop(page, file);
  await expect(page.getByTestId('tab')).toHaveCount(before + 1);
}

/** Make the app use the download path, which is what Safari and Firefox get. */
export async function useDownloads(page: Page): Promise<void> {
  await page.addInitScript(() => {
    delete (window as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showSaveFilePicker;
    delete (window as unknown as Record<string, unknown>).showOpenFilePicker;
    delete (Window.prototype as unknown as Record<string, unknown>).showOpenFilePicker;
  });
}

/**
 * Catch the next file chooser. Call this before page.goto: Playwright doesn't wait for the browser
 * to confirm interception, so a key press sent straight after a listener is added can beat it, and
 * the browser then handles the chooser itself and no event ever arrives.
 */
export function nextFileChooser(page: Page): Promise<FileChooser> {
  return new Promise((resolve) => page.once('filechooser', resolve));
}

/** Trigger a save or download and return the bytes that were written. */
export async function downloadSaved(page: Page, viaAs = false): Promise<Buffer> {
  const downloading = page.waitForEvent('download');
  if (viaAs) {
    await page.keyboard.press('ControlOrMeta+Shift+S');
    await page.getByTestId('dialog').getByRole('button', { name: 'Download', exact: true }).click();
  } else {
    await page.keyboard.press('ControlOrMeta+S');
  }
  const download = await downloading;
  return readFileSync(await download.path());
}

export async function runCommand(page: Page, label: string): Promise<void> {
  await page.waitForFunction(() => document.querySelector('.statusbar') !== null);
  await page.keyboard.press('ControlOrMeta+K');
  const input = page.getByTestId('palette').getByRole('combobox');
  await input.fill(label);
  await page.getByTestId('palette').getByRole('option', { name: label, exact: false }).first().waitFor();
  await input.press('Enter');
  await expect(page.getByTestId('palette')).toHaveCount(0);
}

export const cell = (page: Page, row: number, col: number): Locator =>
  page.locator(`.document:not([hidden]) [data-row="${row}"][data-col="${col}"]`);

export const source = (page: Page): Locator => page.locator('.document:not([hidden]) .cm-content');
export const rendered = (page: Page): Locator => page.locator('.document:not([hidden]) .md-rendered .ProseMirror');

/** Exact source text, read from the editor's lines (small documents only). */
export function sourceText(page: Page): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.document:not([hidden]) .cm-line'))
      .map((line) => line.textContent ?? '')
      .join('\n'),
  );
}

export async function expectClean(page: Page): Promise<void> {
  await expect(page.getByTestId('dirty')).toHaveCount(0);
}
export async function expectDirty(page: Page): Promise<void> {
  await expect(page.getByTestId('dirty')).toHaveCount(1);
}

export function idbRecords(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('full');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const all = db.transaction('documents').objectStore('documents').getAll();
          all.onsuccess = () => {
            db.close();
            resolve(
              all.result.map((r: Record<string, unknown>) => ({
                id: r.id,
                name: r.name,
                sessionId: r.sessionId,
                currentText: r.currentText,
                hasUnsavedChanges: r.hasUnsavedChanges,
              })),
            );
          };
        };
      }),
  );
}

/** Let any accidental write-back happen before asserting that it didn't. */
export const settle = (page: Page) => page.waitForTimeout(700);

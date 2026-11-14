import { expect, Page, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { downloadSaved, expectClean, expectDirty, open, rendered, runCommand, settle, source, useDownloads } from './helpers';

/** The exported file, as the next download. */
async function exported(page: Page, label: string): Promise<{ name: string; bytes: Buffer }> {
  const downloading = page.waitForEvent('download');
  await runCommand(page, label);
  const download = await downloading;
  return { name: download.suggestedFilename(), bytes: readFileSync(await download.path()) };
}

/** Each part of a ZIP, read with Node's own inflate. */
function unzip(bytes: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  const end = bytes.length - 22;
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const offset = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString();
    const start = offset + 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28);
    const data = bytes.subarray(start, start + compressed);
    files.set(name, (method === 8 ? inflateRawSync(data) : data).toString());
    at += 46 + nameLength + bytes.readUInt16LE(at + 30) + bytes.readUInt16LE(at + 32);
  }
  return files;
}

/** window.print() would block or do nothing headless, so it records what would be printed instead. */
async function stubPrint(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __printed: string[] };
    w.__printed = [];
    window.print = () => {
      w.__printed.push(document.getElementById('print-root')?.innerText ?? '');
    };
  });
}
const printed = (page: Page) => page.evaluate(() => (window as unknown as { __printed: string[] }).__printed);

const MARKDOWN = [
  '# Notes',
  '',
  'Some *text* with a [link](https://example.test/page) and an [anchor](#notes).',
  '',
  '- [ ] open',
  '- [x] done',
  '',
  '<script>alert(1)</script>',
  '',
  '<img src=x onerror="alert(1)">',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '| a | b |',
  '|---|---|',
  '| 1 | 2 |',
  '',
].join('\n');

test.describe('export as HTML', () => {
  test.beforeEach(async ({ page }) => {
    await useDownloads(page);
    await page.goto('/');
  });

  test('writes a clean standalone page and leaves the tab as it was @cross', async ({ page }) => {
    await open(page, { name: 'notes.md', bytes: MARKDOWN });
    await rendered(page).locator('h1').waitFor();
    const { name, bytes } = await exported(page, 'Export as HTML');
    expect(name).toBe('notes.html');
    const html = bytes.toString('utf8');
    expect(bytes[0]).toBe('<'.charCodeAt(0));
    expect(html.startsWith('<!doctype html>\n<html>\n')).toBe(true);
    expect(html).not.toContain('\r');
    expect(html).toContain('<title>notes</title>');
    expect(html).toContain('<h1 id="notes">Notes</h1>');
    expect(html).toContain('<a href="https://example.test/page">link</a>');
    expect(html).toContain('<a href="#notes">anchor</a>');
    expect(html).toMatch(/<li class="task"><p><input type="checkbox" disabled=""> open/);
    expect(html).toMatch(/<input type="checkbox" disabled="" checked=""> done/);
    expect(html).toContain('<code class="language-js">const a = 1;</code>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toMatch(/<script|<img|contenteditable|ProseMirror|data-/i);
    const attributes = await page.evaluate((source) => {
      const parsed = new DOMParser().parseFromString(source, 'text/html');
      return Array.from(parsed.querySelectorAll('*')).flatMap((element) => element.getAttributeNames());
    }, html);
    expect(attributes.filter((name) => name.startsWith('on'))).toEqual([]);
    await expect(page.getByTestId('notice-info')).toContainText('Exported notes.html');
    await expect(page.locator('.tab-name')).toHaveText(['notes.md']);
    await expectClean(page);
    expect((await downloadSaved(page)).toString()).toBe(MARKDOWN);
  });

  test('exports unsaved edits, and the tab stays unsaved @cross', async ({ page }) => {
    await open(page, { name: 'a.md', bytes: '# One\n' });
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('\nTyped just now');
    await expectDirty(page);
    const { bytes } = await exported(page, 'Export as HTML');
    expect(bytes.toString()).toContain('<p>Typed just now</p>');
    await expectDirty(page);
  });

  test('the exported page makes no request of its own @cross', async ({ page, browser }) => {
    await open(page, { name: 'a.md', bytes: MARKDOWN });
    const { bytes } = await exported(page, 'Export as HTML');
    const reader = await browser.newPage();
    const requests: string[] = [];
    reader.on('request', (request) => requests.push(request.url()));
    await reader.setContent(bytes.toString());
    await expect(reader.locator('h1')).toHaveText('Notes');
    expect(requests).toEqual([]);
    await reader.close();
  });

  test('keeps remote images as links and makes no request while exporting', async ({ page }) => {
    const requests: string[] = [];
    page.on('request', (request) => requests.push(request.url()));
    await open(page, { name: 'a.md', bytes: '![pic](https://images.example.test/a.png)\n' });
    const { bytes } = await exported(page, 'Export as HTML');
    expect(bytes.toString()).toContain('<img src="https://images.example.test/a.png" alt="pic">');
    await settle(page);
    expect(requests.filter((url) => url.includes('example.test'))).toEqual([]);
  });

  test('only Markdown has it', async ({ page }) => {
    await open(page, { name: 'a.txt', bytes: 'x\n' });
    await page.keyboard.press('ControlOrMeta+K');
    await page.getByTestId('palette').getByRole('combobox').fill('Export as HTML');
    await expect(page.getByTestId('palette').getByRole('option')).toHaveCount(0);
  });
});

test.describe('print or save as PDF', () => {
  test.beforeEach(async ({ page }) => {
    await stubPrint(page);
    await page.goto('/');
  });

  test('prints the whole of a long text file, and nothing of the interface @cross', async ({ page }) => {
    const lines = Array.from({ length: 3000 }, (_, i) => `line ${i + 1}`);
    await open(page, { name: 'long.py', bytes: lines.join('\n') + '\n' });
    await runCommand(page, 'Print or save as PDF');
    await expect.poll(() => printed(page)).toHaveLength(1);
    const [text] = await printed(page);
    expect(text).toContain('line 1\n');
    expect(text).toContain('line 3000');
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('#root')).toBeHidden();
    await expect(page.locator('#print-root')).toBeVisible();
    expect(await page.title()).toBe('long');
  });

  test('Cmd/Ctrl+P prints Markdown as a document @cross', async ({ page }) => {
    await open(page, { name: 'notes.md', bytes: MARKDOWN });
    await rendered(page).locator('h1').waitFor();
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+P');
    await expect.poll(() => printed(page)).toHaveLength(1);
    await expect(page.locator('#print-root h1')).toHaveText('Notes');
    await expect(page.locator('#print-root input[type=checkbox]')).toHaveCount(2);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#print-root')).toHaveCount(0);
    expect(await page.title()).toBe('full');
  });

  test("the browser's own print shows the file, not the interface @cross", async ({ page }) => {
    await open(page, { name: 'a.txt', bytes: 'plain words\n' });
    await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
    await expect(page.locator('#print-root')).toHaveText('plain words\n');
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await expect(page.locator('#print-root')).toHaveCount(0);
  });

  test('CSV has no print command', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: 'a,b\n1,2\n' });
    await page.keyboard.press('ControlOrMeta+K');
    await page.getByTestId('palette').getByRole('combobox').fill('Print');
    await expect(page.getByTestId('palette').getByRole('option')).toHaveCount(0);
  });
});

test.describe('export as Excel', () => {
  test.beforeEach(async ({ page }) => {
    await useDownloads(page);
    await page.goto('/');
  });

  const CSV = 'code;amount;city;note\r\n007;1,50;Girona;"two\r\nlines"\r\n008;2,75;Lleida;=SUM(A1)\r\n';

  test('detects numbers by column and keeps everything else as text @cross', async ({ page }) => {
    await open(page, { name: 'data.csv', bytes: CSV });
    const { name, bytes } = await exported(page, 'Export as Excel');
    expect(name).toBe('data.xlsx');
    const files = unzip(bytes);
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">007</t></is></c>');
    expect(sheet).toContain('<c r="B2" s="3"><v>1.50</v></c>');
    expect(sheet).toContain('<t xml:space="preserve">two\nlines</t>');
    expect(sheet).toContain('<t xml:space="preserve">=SUM(A1)</t>');
    expect(files.get('xl/workbook.xml')).toContain('name="data"');
    await expectClean(page);
    expect((await downloadSaved(page)).toString()).toBe(CSV);
  });

  test('reads quoted comma decimals in a comma-separated file as numbers @cross', async ({ page }) => {
    await open(page, { name: 'prices.csv', bytes: 'name,price,version\nJoan,"1,50",1.2\nMaria,"2,75",1.3\n' });
    const sheet = unzip((await exported(page, 'Export as Excel')).bytes).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="B2" s="3"><v>1.50</v></c>');
    expect(sheet).toContain('<c r="C3" s="4"><v>1.3</v></c>');
  });

  test('a 100,000-row table exports on a worker', async ({ page }) => {
    const workers: string[] = [];
    page.on('worker', (worker) => workers.push(worker.url()));
    const rows = ['id,name,amount'];
    for (let i = 0; i < 99_999; i++) rows.push(`${i},Name ${i},${i}.25`);
    await open(page, { name: 'big.csv', bytes: rows.join('\n') + '\n' });
    await expect(page.getByTestId('status-counts')).toHaveText('100,000 rows × 3 columns');
    const { bytes } = await exported(page, 'Export as Excel');
    expect(workers.some((url) => url.includes('xlsxWorker'))).toBe(true);
    const sheet = unzip(bytes).get('xl/worksheets/sheet1.xml')!;
    expect(sheet.match(/<row /g)).toHaveLength(100_000);
    expect(sheet).toContain('<c r="A100000"><v>99998</v></c>');
    expect(sheet).toContain('<c r="B100000" t="inlineStr"><is><t xml:space="preserve">Name 99998</t></is></c>');
  });

  test('a cell Excel cannot hold refuses the export, naming the cell', async ({ page }) => {
    await open(page, { name: 'long.csv', bytes: `a,b\n1,${'x'.repeat(33_000)}\n` });
    await page.keyboard.press('ControlOrMeta+K');
    await page.getByTestId('palette').getByRole('combobox').fill('Export as Excel');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('notice-error')).toContainText('Cell B2');
  });
});

test.describe('with a save picker (Chrome, Edge)', () => {
  test.skip(({ browserName }) => browserName !== 'chromium');

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as Record<string, unknown>;
      w.showSaveFilePicker = async (options: { suggestedName: string }) => {
        w.__suggested = options.suggestedName;
        if (w.__cancel) throw new DOMException('cancelled', 'AbortError');
        return (await navigator.storage.getDirectory()).getFileHandle('picked.html', { create: true });
      };
    });
    await page.goto('/');
  });

  const opfsNames = (page: Page) =>
    page.evaluate(async () => {
      const names: string[] = [];
      for await (const name of (await navigator.storage.getDirectory()).keys()) names.push(name);
      return names;
    });

  test('writes where the user picks, under the name they chose', async ({ page }) => {
    await open(page, { name: 'notes.md', bytes: '# Hi\n' });
    await runCommand(page, 'Export as HTML');
    await expect(page.getByTestId('notice-info')).toContainText('Exported picked.html');
    expect(await page.evaluate(() => (window as unknown as Record<string, unknown>).__suggested)).toBe('notes.html');
    const text = await page.evaluate(async () => {
      const handle = await (await navigator.storage.getDirectory()).getFileHandle('picked.html');
      return (await handle.getFile()).text();
    });
    expect(text).toContain('<h1 id="hi">Hi</h1>');
    await expect(page.locator('.tab-name')).toHaveText(['notes.md']);
  });

  test('a cancelled picker does nothing at all', async ({ page }) => {
    await page.evaluate(() => ((window as unknown as Record<string, unknown>).__cancel = true));
    await open(page, { name: 'notes.md', bytes: '# Hi\n' });
    await runCommand(page, 'Export as HTML');
    await settle(page);
    await expect(page.getByTestId('notice-info')).toHaveCount(0);
    await expect(page.getByTestId('notice-error')).toHaveCount(0);
  });

  test('a failed write says so and leaves no empty file behind', async ({ page }) => {
    await page.evaluate(() => {
      FileSystemFileHandle.prototype.createWritable = () => Promise.reject(new Error('Disk full'));
    });
    await open(page, { name: 'notes.md', bytes: '# Hi\n' });
    await runCommand(page, 'Export as HTML');
    await expect(page.getByTestId('notice-error')).toContainText('Disk full');
    expect(await opfsNames(page)).not.toContain('picked.html');
    await expectClean(page);
  });
});

import { expect, Page, test } from '@playwright/test';
import { cell, downloadSaved, expectClean, rendered, source, useDownloads } from './helpers';

test.describe.configure({ mode: 'serial', timeout: 90_000 });
test.skip(({ browserName }) => browserName !== 'chromium');

/** Drop a generated file and time it until something has rendered. */
function timedDrop(page: Page, name: string, text: string) {
  return page.evaluate(
    ({ name, text }) => {
      const file = new File([text], name, { lastModified: 1 });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const started = performance.now();
      window.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      return new Promise<number>((resolve) => {
        const poll = () => {
          if (document.querySelector('[data-row="5"][data-col="0"], .cm-content')) resolve(performance.now() - started);
          else setTimeout(poll, 5);
        };
        poll();
      });
    },
    { name, text },
  );
}

test('AC20 a 100,000-row CSV opens within 3 s, on a worker, and scrolls smoothly', async ({ page }) => {
  await useDownloads(page);
  const workers: string[] = [];
  page.on('worker', (w) => workers.push(w.url()));
  await page.goto('/');
  await page.getByTestId('empty').waitFor();

  const rows = ['id;nom;import;data;poble;comentari'];
  for (let i = 0; i < 99_999; i++) {
    rows.push(`${i};Persona ${i};${i % 97},50;2026-01-01;Barcelona;Un comentari una mica llarg`);
  }
  const text = rows.join('\r\n') + '\r\n';
  expect(text.length).toBeGreaterThan(5 * 1024 * 1024);

  const ms = await timedDrop(page, 'big.csv', text);
  console.log(`100k rows, ${(text.length / 1048576).toFixed(1)} MB: opened in ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(3000);
  expect(workers.some((u) => u.includes('csvWorker'))).toBe(true);
  await expect(page.getByTestId('status-counts')).toHaveText('100,000 rows × 6 columns');

  const frames = await page.evaluate(
    () =>
      new Promise<number[]>((resolve) => {
        const el = document.querySelector('[data-testid=grid]') as HTMLElement;
        const times: number[] = [];
        let last = performance.now();
        let frame = 0;
        const tick = () => {
          const now = performance.now();
          times.push(now - last);
          last = now;
          el.scrollTop += 900;
          if (++frame < 150) requestAnimationFrame(tick);
          else resolve(times.slice(5));
        };
        requestAnimationFrame(tick);
      }),
  );
  const sorted = frames.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`scroll frames: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`);
  expect(median).toBeLessThan(34);
  expect(p95).toBeLessThan(70);

  await page.evaluate(() => {
    (document.querySelector('[data-testid=grid]') as HTMLElement).scrollTop = 0;
  });
  await expect(cell(page, 1, 1)).toHaveText('Persona 0');
  await cell(page, 1, 1).click();
  const started = Date.now();
  await page.keyboard.type('Editat');
  await page.keyboard.press('Enter');
  await expect(cell(page, 1, 1)).toHaveText('Editat');
  const editMs = Date.now() - started;
  console.log(`cell edit: ${editMs} ms`);
  expect(editMs).toBeLessThan(1000);

  const saved = await downloadSaved(page);
  expect(saved.toString()).toBe(text.replace('0;Persona 0;', '0;Editat;'));
  await expectClean(page);
});

for (const bar of [false, true]) test(`AC20 typing in a 1 MB Markdown file has no noticeable lag${bar ? ', with the formatting bar shown' : ''}`, async ({ page }) => {
  if (bar) await page.addInitScript(() => localStorage.setItem('full.formatBar', '1'));
  await page.goto('/');
  await page.getByTestId('empty').waitFor();
  let text = '';
  for (let i = 0; text.length < 1024 * 1024; i++) {
    text += `## Section ${i}\n\nSome *body* text with a [link](https://example.test/${i}) and __bold__ words, repeated to fill the document.\n\n* item one\n* item two\n\n`;
  }
  const ms = await timedDrop(page, 'big.md', text);
  console.log(`1 MB Markdown: opened in ${ms.toFixed(0)} ms`);
  await expect(rendered(page).locator('h2').first()).toBeVisible({ timeout: 30_000 });
  if (bar) await expect(page.getByTestId('format-bar')).toBeVisible();
  await page.waitForTimeout(1000);
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Home');

  // Time from keydown to the frame after it, across a burst of ordinary typing.
  await page.evaluate(() => {
    const samples: number[] = [];
    (window as unknown as { __latency: number[] }).__latency = samples;
    window.addEventListener(
      'keydown',
      () => {
        const t0 = performance.now();
        requestAnimationFrame(() => setTimeout(() => samples.push(performance.now() - t0), 0));
      },
      true,
    );
  });
  for (const ch of 'the quick brown fox jumps over the lazy dog') {
    await page.keyboard.type(ch);
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(300);
  const latency = await page.evaluate(() => (window as unknown as { __latency: number[] }).__latency);
  const sorted = latency.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`typing latency: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${sorted.at(-1)!.toFixed(1)} ms`);
  expect(median).toBeLessThan(50);
  expect(p95).toBeLessThan(100);
  await expect(page.getByTestId('dirty')).toHaveCount(1);
});

async function typingLatency(page: Page, label: string): Promise<void> {
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.evaluate(() => {
    const samples: number[] = [];
    (window as unknown as { __latency: number[] }).__latency = samples;
    window.addEventListener(
      'keydown',
      () => {
        const t0 = performance.now();
        requestAnimationFrame(() => setTimeout(() => samples.push(performance.now() - t0), 0));
      },
      true,
    );
  });
  for (const ch of 'the quick brown fox jumps over the lazy dog') {
    await page.keyboard.type(ch);
    await page.waitForTimeout(70);
  }
  await page.waitForTimeout(300);
  const latency = await page.evaluate(() => (window as unknown as { __latency: number[] }).__latency);
  const sorted = latency.slice().sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`${label}: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${sorted.at(-1)!.toFixed(1)} ms`);
  expect(median).toBeLessThan(50);
  expect(p95).toBeLessThan(100);
}

const JS_LINE = 'function greet(name) { return `hello ${name}`.trim(); } // a comment\n';

test('typing in a coloured code file at the size limit has no noticeable lag', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('empty').waitFor();
  const text = JS_LINE.repeat(Math.floor((1024 * 1024) / JS_LINE.length));
  const ms = await timedDrop(page, 'big.js', text);
  console.log(`1 MB JavaScript: opened in ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(3000);
  await page.waitForTimeout(500);
  await typingLatency(page, 'typing in 1 MB of JavaScript');
});

test('typing in a coloured file with lines at the length limit has no noticeable lag', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('empty').waitFor();
  const longLine = JS_LINE.trimEnd().repeat(Math.floor(10_000 / JS_LINE.length)) + '\n';
  const text = longLine.repeat(Math.floor((1024 * 1024) / longLine.length));
  const ms = await timedDrop(page, 'long-lines.js', text);
  console.log(`1 MB of 10,000-character lines: opened in ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(3000);
  await page.waitForTimeout(500);
  await typingLatency(page, 'typing in 10,000-character lines');
});

test('typing in a minified file stays quick, because it is not coloured', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('empty').waitFor();
  const text = JS_LINE.replace(' // a comment\n', '').repeat(Math.floor((1024 * 1024) / JS_LINE.length) + 2000);
  const ms = await timedDrop(page, 'bundle.min.js', text.slice(0, 1024 * 1024));
  console.log(`1 MB on one line: opened in ${ms.toFixed(0)} ms`);
  expect(ms).toBeLessThan(3000);
  await page.waitForTimeout(500);
  await typingLatency(page, 'typing in 1 MB on one line');
});

test('a big document renders the same section by section, including lists and code', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('empty').waitFor();
  const filler = '# Filler\n\n' + 'word '.repeat(25_000) + '\n\n';
  const tail = '# After\n\n* item\n\n  still item\n\n```\n# not heading\n```\n\n## Sub\n\n1. one\n2. two\n';
  await timedDrop(page, 'split.md', filler + tail);
  const root = rendered(page);
  await expect(root.locator('h1')).toHaveCount(2);
  await expect(root.locator('h2')).toHaveText('Sub');
  await expect(root.locator('pre code')).toHaveText('# not heading');
  await expect(root.locator('ol li')).toHaveCount(2);
  await page.waitForTimeout(500);
  await expectClean(page);
});

const HTML_BLOCK = '<section><h2>Section</h2><p>Some <b>body</b> text with a <a href="https://example.test/">link</a>, repeated to fill the page.</p><ul><li>one</li><li>two</li></ul></section>\n';

for (const [label, size] of [
  ['1 MB, past the limit, so the preview holds still', 1024 * 1024 + 4096],
  ['just under the limit, so the preview follows', 900 * 1024],
] as const) {
  test(`typing in an HTML file with the preview open: ${label}`, async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('empty').waitFor();
    const text = '<!doctype html>\n<title>Big</title>\n' + HTML_BLOCK.repeat(Math.ceil(size / HTML_BLOCK.length));
    const ms = await timedDrop(page, 'big.html', text);
    console.log(`${(text.length / 1048576).toFixed(2)} MB HTML: opened in ${ms.toFixed(0)} ms`);
    await page.keyboard.press('ControlOrMeta+Alt+1');
    const frame = page.frameLocator('.html-preview-frame');
    await expect(frame.locator('h2').first()).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(1000);
    await typingLatency(page, `typing in HTML, ${label}`);
  });
}

test('exporting a 100,000-row CSV to Excel leaves typing elsewhere unaffected', async ({ page }) => {
  await useDownloads(page);
  await page.goto('/');
  await page.getByTestId('empty').waitFor();
  const rows = ['id;nom;import;data;poble;comentari'];
  for (let i = 0; i < 99_999; i++) rows.push(`${i};Persona ${i};${i % 97},50;2026-01-01;Barcelona;Un comentari una mica llarg`);
  await timedDrop(page, 'big.csv', rows.join('\r\n') + '\r\n');
  await expect(page.getByTestId('status-counts')).toHaveText('100,000 rows × 6 columns');
  let text = '';
  for (let i = 0; text.length < 200 * 1024; i++) text += `## Section ${i}\n\nSome *body* text.\n\n`;
  await timedDrop(page, 'notes.md', text);
  await expect(rendered(page).locator('h2').first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(500);

  const downloading = page.waitForEvent('download', { timeout: 30_000 }).then((download) => ({ download, at: Date.now() }));
  const started = Date.now();
  // Start the export from the CSV tab, then type in the Markdown tab while it runs.
  await page.getByTestId('tab').first().locator('.tab-name').click();
  await page.keyboard.press('ControlOrMeta+K');
  await page.getByTestId('palette').getByRole('combobox').fill('Export as Excel');
  await page.keyboard.press('Enter');
  await page.getByTestId('tab').nth(1).locator('.tab-name').click();
  await typingLatency(page, 'typing in Markdown during a 100,000-row export');
  const { download, at } = await downloading;
  const exportMs = at - started;
  console.log(`100,000-row export: ${exportMs} ms, ${download.suggestedFilename()}`);
  expect(download.suggestedFilename()).toBe('big.xlsx');
  expect(exportMs).toBeLessThan(5000);
});

test('reopening ten tabs shows the active one quickly, and typing keeps up while the rest load', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('empty').waitFor();
  const rows = ['id;nom;import'];
  for (let i = 0; i < 99_999; i++) rows.push(`${i};Persona ${i};${i % 97},50`);
  await timedDrop(page, 'big.csv', rows.join('\r\n') + '\r\n');
  await expect(page.getByTestId('status-counts')).toHaveText('100,000 rows × 3 columns');
  let markdown = '';
  for (let i = 0; markdown.length < 1024 * 1024; i++) markdown += `## Section ${i}\n\nSome *body* text.\n\n`;
  await timedDrop(page, 'big.md', markdown);
  for (let i = 0; i < 7; i++) await timedDrop(page, `note${i}.txt`, `note ${i}\n`.repeat(200));
  await timedDrop(page, 'active.md', '# Active\n\nText.\n');
  await expect(page.getByTestId('tab')).toHaveCount(10);
  await page.waitForTimeout(1500);

  const started = Date.now();
  await page.reload();
  await expect(page.locator('.tab.active .tab-name')).toHaveText('active.md');
  await source(page).waitFor();
  const shownMs = Date.now() - started;
  console.log(`ten tabs reopened: active tab editable after ${shownMs} ms`);
  expect(shownMs).toBeLessThan(3000);
  await expect(page.getByTestId('tab')).toHaveCount(10);
  await typingLatency(page, 'typing while the other tabs load');
});

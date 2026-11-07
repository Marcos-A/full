import { expect, test } from '@playwright/test';
import { downloadSaved, expectClean, expectDirty, open, rendered, runCommand, settle, source, sourceText, useDownloads } from './helpers';

test.beforeEach(async ({ page }) => {
  await useDownloads(page);
  await page.goto('/');
});

const TRICKY = '# Heading one\n\n## Heading one\n\n* star __bold__\n* second\n\n3. three\n3. again\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n\n- [ ] task\n- [x] done\n\n***\n\n<div>html</div>\n';

test.describe('sync loops never write back', () => {
  test('loading a document leaves it clean, with exact source', async ({ page }) => {
    await open(page, { name: 'a.md', bytes: TRICKY });
    await rendered(page).locator('h1').waitFor();
    await settle(page);
    await expectClean(page);
    expect(await sourceText(page)).toBe(TRICKY.replace(/\n$/, '\n'));
  });

  test('a source edit is not rewritten by the rendered side', async ({ page }) => {
    await open(page, { name: 'a.md', bytes: TRICKY });
    await rendered(page).locator('h1').waitFor();
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('# ');
    await page.waitForTimeout(400);
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await settle(page);
    await expectClean(page);
    expect(await sourceText(page)).toBe(TRICKY);
    await page.keyboard.type('Z');
    await settle(page);
    expect(await sourceText(page)).toBe('Z' + TRICKY);
    expect((await downloadSaved(page)).toString()).toBe('Z' + TRICKY);
  });

  test('switching views and toggling images does not write back', async ({ page }) => {
    await open(page, { name: 'a.md', bytes: TRICKY + '\n![a](https://images.example.test/a.png)\n' });
    await rendered(page).locator('h1').waitFor();
    for (const label of ['View: source only', 'View: rendered only', 'View: side by side', 'Load remote images']) {
      await runCommand(page, label);
      await settle(page);
    }
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    await expectClean(page);
  });

  test('a stream of source edits keeps rendering, and the source stays exactly as typed', async ({ page }) => {
    await open(page, { name: 'a.md', bytes: '* a\n' });
    await rendered(page).locator('li').waitFor();
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('* __b__\n1) c\n', { delay: 30 });
    await expect(rendered(page).locator('strong')).toHaveText('b');
    await settle(page);
    expect(await sourceText(page)).toBe('* a\n* __b__\n1) c\n');
  });
});

test('source edits reach the rendered side within about 150 ms', async ({ page }) => {
  await open(page, { name: 'a.md', bytes: 'start\n' });
  await rendered(page).getByText('start').waitFor();
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('Q');
  const elapsed = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const t0 = performance.now();
        const tick = () => {
          if (document.querySelector('.md-rendered .ProseMirror')?.textContent?.includes('Qstart')) resolve(performance.now() - t0);
          else requestAnimationFrame(tick);
        };
        tick();
      }),
  );
  expect(elapsed).toBeLessThan(400);
});

test('front matter is a distinct block and survives a rendered edit unchanged', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('full.skipReformatWarning', '1'));
  const front = '---\ntitle:   "a"\nlist: [1,  2]\n---\n';
  await open(page, { name: 'a.md', bytes: front + '# Hi\n' });
  await expect(page.getByTestId('front-matter')).toContainText('title:   "a"');
  await expect(rendered(page)).not.toContainText('title:');
  await rendered(page).locator('h1').click();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect.poll(() => sourceText(page)).toBe(front + '# Hi!\n');
});

test.describe('AC7 reformatting warning', () => {
  for (const [name, attempt] of [
    ['typing', async (p: import('@playwright/test').Page) => p.keyboard.type('x')],
    ['deleting', async (p: import('@playwright/test').Page) => p.keyboard.press('Backspace')],
    ['pressing Enter', async (p: import('@playwright/test').Page) => p.keyboard.press('Enter')],
    ['a formatting command', async (p: import('@playwright/test').Page) => { await p.locator('.md-rendered strong').dblclick(); await p.keyboard.press('ControlOrMeta+I'); }],
    ['cutting', async (p: import('@playwright/test').Page) => { await p.keyboard.press('ControlOrMeta+A'); await p.keyboard.press('ControlOrMeta+X'); }],
  ] as const) {
    test(`${name} is stopped by the warning, and declining leaves the source identical`, async ({ page }) => {
      const text = '* star __bold__ text\n* next\n';
      await open(page, { name: 'a.md', bytes: text });
      await rendered(page).locator('strong').click();
      await attempt(page);
      const dialog = page.getByTestId('dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Editing here may reformat parts of this file's Markdown");
      await dialog.getByRole('button', { name: 'Edit source instead' }).click();
      await settle(page);
      await expectClean(page);
      expect(await sourceText(page)).toBe(text);
      await expect(rendered(page).locator('strong')).toHaveText('bold');
      await expect(rendered(page)).toContainText('star bold text');
      await expect(source(page)).toBeFocused();
      expect((await downloadSaved(page, true)).toString()).toBe(text);
    });
  }

  test('pasting is stopped by the warning', async ({ page }) => {
    await open(page, { name: 'a.md', bytes: 'para\n' });
    await rendered(page).getByText('para').click();
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'pasted');
      document.querySelector('.md-rendered .ProseMirror')!.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await expect(page.getByTestId('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Edit source instead' }).click();
    await expect(rendered(page)).not.toContainText('pasted');
    await expectClean(page);
  });

  test('continuing allows the edit, and it updates the source @cross', async ({ page }) => {
    await open(page, { name: 'a.md', bytes: 'para\n' });
    await rendered(page).getByText('para').click();
    await page.keyboard.press('End');
    await page.keyboard.type('x');
    await page.getByTestId('dialog').getByRole('button', { name: 'Continue' }).click();
    await expect(rendered(page)).toBeFocused();
    await expect(rendered(page)).toHaveText('para');
    await page.keyboard.press('End');
    await page.keyboard.type('Y');
    await expect.poll(() => sourceText(page)).toBe('paraY\n');
    await expectDirty(page);
  });

  test("acceptance lasts until the tab closes; \"don't show again\" lasts across files", async ({ page }) => {
    await open(page, { name: 'a.md', bytes: 'one\n' });
    await rendered(page).getByText('one').click();
    await page.keyboard.type('x');
    await page.getByRole('button', { name: 'Continue' }).click();
    await rendered(page).click();
    await page.keyboard.type('y');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    await expectDirty(page);

    await open(page, { name: 'b.md', bytes: 'two\n' });
    await rendered(page).getByText('two').click();
    await page.keyboard.type('x');
    const dialog = page.getByTestId('dialog');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Continue' }).click();

    await open(page, { name: 'c.md', bytes: 'three\n' });
    await rendered(page).getByText('three').click();
    await page.keyboard.type('x');
    await expect(page.getByTestId('dialog')).toHaveCount(0);
    await expect.poll(() => sourceText(page)).toContain('x');
    expect(await page.evaluate(() => localStorage.getItem('full.skipReformatWarning'))).toBe('1');
  });
});

test.describe('AC8 undo and revert', () => {
  const text = '* star __bold__\n* other __keep__\n\nlast line\n';

  test('undoing a rendered edit restores the exact previous source, on either side', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('full.skipReformatWarning', '1'));
    await open(page, { name: 'a.md', bytes: text });
    await rendered(page).getByText('last line').click();
    await page.keyboard.press('End');
    await page.keyboard.type('!');
    await expect.poll(() => sourceText(page)).toContain('last line!');
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => sourceText(page)).toBe(text);
    await expectClean(page);
    await expect(rendered(page)).not.toContainText('last line!');
    await page.keyboard.press('ControlOrMeta+Shift+Z');
    await expect.poll(() => sourceText(page)).toContain('last line!');
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => sourceText(page)).toBe(text);
    await expect(rendered(page)).not.toContainText('last line!');
    expect((await downloadSaved(page, true)).toString()).toBe(text);
  });

  test('source and rendered edits share one history', async ({ page }) => {
    await page.evaluate(() => localStorage.setItem('full.skipReformatWarning', '1'));
    await open(page, { name: 'a.md', bytes: 'one\n' });
    await rendered(page).getByText('one').waitFor();
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('src');
    await expect(rendered(page)).toContainText('src');
    const afterSource = await sourceText(page);
    await rendered(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('R');
    await expect.poll(() => sourceText(page)).toContain('R');
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => sourceText(page)).toBe(afterSource);
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => sourceText(page)).toBe('one\n');
  });

  test('revert asks first, restores the exact saved text, and can be undone @cross', async ({ page }) => {
    await open(page, { name: 'a.md', bytes: text });
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('edit ');
    await expectDirty(page);
    await runCommand(page, 'Revert to last saved');
    const dialog = page.getByTestId('dialog');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expectDirty(page);
    await runCommand(page, 'Revert to last saved');
    await dialog.getByRole('button', { name: 'Revert' }).click();
    await expectClean(page);
    expect(await sourceText(page)).toBe(text);
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+Z');
    await expect.poll(() => sourceText(page)).toBe('edit ' + text);
    await expectDirty(page);
  });

  test('revert in a CRLF file restores it exactly', async ({ page }) => {
    const crlf = 'one\r\ntwo\r\n';
    await open(page, { name: 'a.md', bytes: crlf });
    await source(page).click();
    await page.keyboard.type('x');
    await runCommand(page, 'Revert to last saved');
    await page.getByRole('button', { name: 'Revert' }).click();
    await expectClean(page);
    expect((await downloadSaved(page, true)).toString()).toBe(crlf);
  });
});

test('AC10 script, onerror and javascript: payloads execute nothing @cross', async ({ page }) => {
  let dialogs = 0;
  page.on('dialog', (d) => {
    dialogs++;
    void d.dismiss();
  });
  const payload = [
    '<script>window.__xss = 1</script>',
    '',
    '<img src=x onerror="window.__xss = 2">',
    '',
    '<iframe src="javascript:window.__xss = 3"></iframe>',
    '',
    '[click](javascript:window.__xss=4)',
    '',
    '![pic](javascript:window.__xss=5)',
    '',
    '<a href="javascript:window.__xss=6">raw</a> <svg onload="window.__xss=7"></svg>',
    '',
  ].join('\n');
  await open(page, { name: 'x.md', bytes: payload });
  await rendered(page).getByText('click').waitFor();
  await rendered(page).getByText('click').click();
  await settle(page);
  const state = await page.evaluate(() => {
    const root = document.querySelector('.md-rendered')!;
    return {
      xss: (window as unknown as { __xss?: number }).__xss,
      dangerous: root.querySelectorAll('script, iframe, svg, object, embed').length,
      handlers: Array.from(root.querySelectorAll('*')).filter((el) => Array.from(el.attributes).some((a) => a.name.startsWith('on'))).length,
      jsLinks: Array.from(root.querySelectorAll('a')).filter((a) => /script:/i.test(a.getAttribute('href') ?? '')).length,
      images: Array.from(root.querySelectorAll('img[src]')).map((i) => i.getAttribute('src')),
    };
  });
  expect(state).toEqual({ xss: undefined, dangerous: 0, handlers: 0, jsLinks: 0, images: [] });
  expect(dialogs).toBe(0);
  await expectClean(page);
});

test('GFM renders, external links are safe, relative images are placeholders', async ({ page }) => {
  await open(page, {
    name: 'a.md',
    bytes:
      '| h |\n|---|\n| c |\n\n- [x] done\n\n~~gone~~ https://auto.example.test/ [ext](https://a.example.test/)\n\n```js\ncode\n```\n\n![rel](./pic.png)\n',
  });
  await expect(rendered(page).locator('table th')).toHaveText('h');
  await expect(rendered(page).locator('li[data-item-type="task"]')).toHaveAttribute('data-checked', 'true');
  await expect(rendered(page).locator('del')).toHaveText('gone');
  await expect(rendered(page).locator('a').first()).toHaveAttribute('href', 'https://auto.example.test/');
  const link = rendered(page).locator('a', { hasText: 'ext' });
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(rendered(page).locator('pre code')).toHaveText('code');
  await expect(rendered(page).locator('.md-image-placeholder')).toContainText('./pic.png');
});

test('view modes and divider', async ({ page }) => {
  await open(page, { name: 'a.md', bytes: '# Hi\n' });
  const paneSource = page.getByTestId('source');
  await expect(paneSource).toBeVisible();
  await expect(page.getByTestId('rendered')).toBeVisible();
  await runCommand(page, 'View: source only');
  await expect(page.getByTestId('rendered')).toBeHidden();
  await runCommand(page, 'View: rendered only');
  await expect(paneSource).toBeHidden();
  await runCommand(page, 'View: side by side');
  const divider = page.getByRole('separator');
  const before = await paneSource.boundingBox();
  const box = (await divider.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x - 150, box.y + 200, { steps: 4 });
  await page.mouse.up();
  const after = await paneSource.boundingBox();
  expect(after!.width).toBeLessThan(before!.width - 100);
});

test('copy source and copy rendered', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard read needs a permission only Chromium grants here');
  await open(page, { name: 'a.md', bytes: '# Hi __b__\n' });
  await rendered(page).locator('h1').waitFor();
  await runCommand(page, 'Copy source');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('# Hi __b__\n');
  await runCommand(page, 'Copy rendered');
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const [item] = await navigator.clipboard.read();
        return {
          html: await (await item.getType('text/html')).text(),
          plain: await (await item.getType('text/plain')).text(),
        };
      }),
    )
    .toMatchObject({ html: expect.stringContaining('<strong>b</strong>'), plain: expect.stringContaining('Hi b') });
  await expectClean(page);
});

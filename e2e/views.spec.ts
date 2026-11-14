import { expect, test } from '@playwright/test';
import { downloadSaved, expectClean, open, rendered, runCommand, settle, source, useDownloads } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const panes = (page: import('@playwright/test').Page) => ({
  source: page.locator('.document:not([hidden]) [data-testid=source]'),
  rendered: page.locator('.document:not([hidden]) [data-testid=rendered]'),
});

test('Cmd/Ctrl+Alt+1, 2 and 3 switch the Markdown views from either side @cross', async ({ page }) => {
  await open(page, { name: 'a.md', bytes: '# Title\n\nText\n' });
  await rendered(page).locator('h1').waitFor();
  const { source: sourcePane, rendered: renderedPane } = panes(page);
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Alt+3');
  await expect(sourcePane).toBeHidden();
  await expect(renderedPane).toBeVisible();
  // The rendered side now has the focus, and the keys still work from there.
  await expect(rendered(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Alt+2');
  await expect(renderedPane).toBeHidden();
  await expect(sourcePane).toBeVisible();
  await expect(source(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+Alt+1');
  await expect(sourcePane).toBeVisible();
  await expect(renderedPane).toBeVisible();
  // Nothing was typed into the file by the key presses.
  await expect(page.getByTestId('dirty')).toHaveCount(0);
});

test('Alt and AltGr with a digit stay typing keys, so "@" and "#" can be typed @cross', async ({ page }) => {
  await open(page, { name: 'a.md', bytes: '# T\n' });
  await rendered(page).locator('h1').waitFor();
  await source(page).click();
  // A Spanish Mac's Option+2 types "@", and Windows' AltGr is Ctrl+Alt.
  const taken = await page.evaluate(() =>
    [
      { altKey: true, code: 'Digit2', key: '@' },
      { altKey: true, ctrlKey: true, code: 'Digit3', key: '#' },
    ].map((init) => {
      const event = new KeyboardEvent('keydown', { ...init, bubbles: true, cancelable: true });
      document.querySelector('.document:not([hidden]) .cm-content')!.dispatchEvent(event);
      return event.defaultPrevented;
    }),
  );
  expect(taken).toEqual([false, false]);
  await expect(panes(page).rendered).toBeVisible();
  await page.keyboard.press('Alt+2');
  await expect(panes(page).rendered).toBeVisible();
});

test('the palette shows the view shortcuts', async ({ page }) => {
  await open(page, { name: 'a.md', bytes: '# Title\n' });
  await page.keyboard.press('ControlOrMeta+K');
  await page.getByTestId('palette').getByRole('combobox').fill('View: source');
  await expect(page.getByTestId('palette').getByRole('option').first()).toContainText('Alt+2');
});

test('the view keys do nothing in a plain text file @cross', async ({ page }) => {
  await open(page, { name: 'a.txt', bytes: 'x\n' });
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Alt+3');
  await expect(panes(page).source).toBeVisible();
  await expect(page.getByTestId('dirty')).toHaveCount(0);
});

test.describe('HTML preview', () => {
  const frame = (page: import('@playwright/test').Page) => page.frameLocator('.document:not([hidden]) .html-preview-frame');
  const PAGE = [
    '<!doctype html>',
    '<html lang="en"><head><title>T</title>',
    '<style>h1 { color: rgb(200, 0, 0); }</style>',
    '<link rel="stylesheet" href="https://cdn.example.test/style.css">',
    '<style>@import url("https://cdn.example.test/import.css"); @font-face { font-family: X; src: url("https://cdn.example.test/font.woff2"); } p { font-family: X; background: url("https://cdn.example.test/bg.png"); }</style>',
    '</head><body onload="document.body.dataset.ran = 1">',
    '<h1 id="top">Hello</h1>',
    '<p>Text <a href="https://example.test/page">out</a> <a href="#end">down</a> <a href="other.html">near</a></p>',
    '<img src="https://images.example.test/a.png" alt="remote">',
    '<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="inline" onerror="document.body.dataset.ran = 2">',
    '<script>document.body.dataset.ran = 3; parent.document.title = "pwned";</script>',
    '<div style="height: 3000px"></div><h2 id="end">End</h2>',
    '</body></html>',
    '',
  ].join('\n');

  test('opens as source only, with no frame until a preview is asked for @cross', async ({ page }) => {
    await open(page, { name: 'page.html', bytes: PAGE });
    await expect(panes(page).source).toBeVisible();
    await expect(page.locator('.html-preview-frame')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Alt+1');
    await expect(frame(page).locator('h1')).toHaveText('Hello');
    await expect(frame(page).locator('h1')).toHaveCSS('color', 'rgb(200, 0, 0)');
    await page.keyboard.press('ControlOrMeta+Alt+2');
    await expect(page.locator('.html-preview-frame')).toHaveCount(0);
  });

  test('runs nothing and loads nothing from the file @cross', async ({ page }) => {
    const external: string[] = [];
    await page.route(/example\.test/, (route) => {
      external.push(route.request().url());
      return route.fulfill({ body: '' });
    });
    await open(page, { name: 'page.html', bytes: PAGE });
    await page.keyboard.press('ControlOrMeta+Alt+3');
    await expect(frame(page).locator('h1')).toHaveText('Hello');
    await settle(page);
    expect(await frame(page).locator('body').getAttribute('data-ran')).toBeNull();
    expect(await page.title()).toBe('full');
    expect(external).toEqual([]);

    await runCommand(page, 'Load remote images');
    await expect(frame(page).locator('img[alt=remote]')).toHaveJSProperty('complete', true);
    await expect.poll(() => external).toContain('https://images.example.test/a.png');
    await settle(page);
    // Images, including CSS ones, are what the command allows. Stylesheets, imports and fonts stay blocked.
    expect(external.filter((url) => !url.includes('images.example.test') && !url.endsWith('/bg.png'))).toEqual([]);
    expect(await frame(page).locator('body').getAttribute('data-ran')).toBeNull();
  });

  test('links open as they do in Markdown, and in-page links scroll @cross', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __opened: string[] };
      w.__opened = [];
      window.open = (url?: string | URL) => {
        w.__opened.push(String(url));
        return null;
      };
    });
    await page.reload();
    await open(page, { name: 'page.html', bytes: PAGE });
    await page.keyboard.press('ControlOrMeta+Alt+3');
    await frame(page).getByRole('link', { name: 'out' }).click();
    await frame(page).getByRole('link', { name: 'near' }).click();
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://example.test/page']);
    await frame(page).getByRole('link', { name: 'down' }).click();
    await expect(frame(page).locator('#end')).toBeInViewport();
    await expect(frame(page).locator('h1')).toHaveText('Hello');
  });

  test('previewing and saving leaves the file byte-identical @cross', async ({ page }) => {
    await useDownloads(page);
    await page.reload();
    const bytes = Buffer.from('﻿<!DOCTYPE html>\r\n<p>café</p>\r\n', 'utf8');
    await open(page, { name: 'page.htm', bytes });
    await page.keyboard.press('ControlOrMeta+Alt+1');
    await expect(frame(page).locator('p')).toHaveText('café');
    await settle(page);
    await expectClean(page);
    expect(await downloadSaved(page)).toEqual(bytes);
  });

  test('follows edits once typing pauses, and keeps its scroll position @cross', async ({ page }) => {
    await open(page, { name: 'page.html', bytes: PAGE });
    await page.keyboard.press('ControlOrMeta+Alt+1');
    await expect(frame(page).locator('h1')).toHaveText('Hello');
    await frame(page).locator('body').evaluate(() => window.scrollTo(0, 1200));
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('<p id="added">Added</p>');
    await expect(frame(page).locator('#added')).toHaveText('Added');
    expect(await frame(page).locator('body').evaluate(() => document.scrollingElement!.scrollTop)).toBe(1200);
  });

  test('a link keeps the page where it was, and an automatic redirect never opens anything @cross', async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __opened: string[] };
      w.__opened = [];
      window.open = (url?: string | URL) => {
        w.__opened.push(String(url));
        return null;
      };
    });
    await page.reload();
    const redirect = '<meta http-equiv="refresh" content="0; url=https://example.test/auto">';
    await open(page, { name: 'r.html', bytes: redirect + '<div style="height: 2000px"></div><a href="https://example.test/b">b</a>' });
    await page.keyboard.press('ControlOrMeta+Alt+3');
    await settle(page);
    await frame(page).getByRole('link', { name: 'b' }).scrollIntoViewIfNeeded();
    const before = await frame(page).locator('body').evaluate(() => document.scrollingElement!.scrollTop);
    expect(before).toBeGreaterThan(500);
    await frame(page).getByRole('link', { name: 'b' }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toEqual(['https://example.test/b']);
    await expect(frame(page).getByRole('link', { name: 'b' })).toBeVisible();
    expect(await frame(page).locator('body').evaluate(() => document.scrollingElement!.scrollTop)).toBeGreaterThan(500);
  });

  test('the app keys work from inside the preview @cross', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', "WebKit doesn't hand the frame's keys to the app. The Mac app's menu still takes its shortcuts.");
    await open(page, { name: 'page.html', bytes: PAGE });
    await page.keyboard.press('ControlOrMeta+Alt+3');
    await frame(page).locator('h1').click();
    await page.keyboard.press('ControlOrMeta+Alt+2');
    await expect(page.locator('.html-preview-frame')).toHaveCount(0);
    await expect(panes(page).source).toBeVisible();
  });

  test('only the active tab has a frame', async ({ page }) => {
    await open(page, { name: 'a.html', bytes: '<p>A</p>' });
    await page.keyboard.press('ControlOrMeta+Alt+1');
    await open(page, { name: 'b.html', bytes: '<p>B</p>' });
    await page.keyboard.press('ControlOrMeta+Alt+1');
    await expect(frame(page).locator('p')).toHaveText('B');
    await expect(page.locator('.html-preview-frame')).toHaveCount(1);
    await page.getByTestId('tab').first().locator('.tab-name').click();
    await expect(frame(page).locator('p')).toHaveText('A');
    await expect(page.locator('.html-preview-frame')).toHaveCount(1);
  });

  test('a very large file stops following typing, and says so', async ({ page }) => {
    const big = '<p>start</p>\n' + '<p>filler text for a big page</p>\n'.repeat(36_000);
    expect(big.length).toBeGreaterThan(1024 * 1024);
    await open(page, { name: 'big.html', bytes: big });
    await page.keyboard.press('ControlOrMeta+Alt+1');
    await expect(frame(page).locator('p').first()).toHaveText('start');
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.keyboard.type('<h1>new</h1>');
    await expect(page.locator('.html-preview-note')).toBeVisible();
    await settle(page);
    await expect(frame(page).locator('h1')).toHaveCount(0);
  });
});

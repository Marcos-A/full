import { expect, Page, test } from '@playwright/test';
import { cell, downloadSaved, expectClean, expectDirty, open, rendered, runCommand, source, useDownloads } from './helpers';

test.beforeEach(async ({ page }) => {
  await useDownloads(page);
  await page.goto('/');
});

const panel = (page: Page) => page.locator('.document:not([hidden]) .cm-search');
const findField = (page: Page) => panel(page).locator('input[name=search]');
const replaceField = (page: Page) => panel(page).locator('input[name=replace]');

const bar = (page: Page) => page.getByTestId('grid-find');
const query = (page: Page) => page.getByTestId('grid-find-query');
const replacement = (page: Page) => page.getByTestId('grid-find-replacement');
const status = (page: Page) => page.getByTestId('grid-find-status');
const active = (page: Page) => page.locator('.document:not([hidden]) .cell.active');

test.describe('in a text editor', () => {
  test('Cmd/Ctrl+F opens the find panel, and Cmd/Ctrl+Alt+F focuses its replace field @cross', async ({ page }) => {
    await open(page, { name: 'notes.txt', bytes: 'one two\nthree two\n' });
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+F');
    await expect(findField(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Alt+F');
    await expect(replaceField(page)).toBeFocused();
    // Again from the replace field, back to the find field.
    await page.keyboard.press('ControlOrMeta+F');
    await expect(findField(page)).toBeFocused();
  });

  test('the palette has both, and leaves the focus in the panel @cross', async ({ page }) => {
    await open(page, { name: 'code.js', bytes: 'const a = 1;\n' });
    await runCommand(page, 'Find and replace…');
    await expect(replaceField(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await runCommand(page, 'Find…');
    await expect(findField(page)).toBeFocused();
  });

  test('raw CSV text uses the editor panel', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: 'a;b\n1;2\n' });
    await runCommand(page, 'View: raw CSV text');
    await page.keyboard.press('ControlOrMeta+F');
    await expect(findField(page)).toBeFocused();
    await expect(bar(page)).toHaveCount(0);
  });
});

test.describe('from the rendered side', () => {
  test('rendered only Markdown switches to the source and searches there @cross', async ({ page }) => {
    await open(page, { name: 'a.md', bytes: '# Title\n\nSome text.\n' });
    await page.keyboard.press('ControlOrMeta+Alt+3');
    await rendered(page).click();
    await page.keyboard.press('ControlOrMeta+F');
    await expect(findField(page)).toBeFocused();
    await expect(page.locator('.document:not([hidden]) [data-testid=rendered]')).toBeHidden();
  });

  test('side by side stays side by side, with the panel in the source', async ({ page }) => {
    await open(page, { name: 'a.md', bytes: '# Title\n\nSome text.\n' });
    await rendered(page).click();
    await page.keyboard.press('ControlOrMeta+Alt+F');
    await expect(replaceField(page)).toBeFocused();
    await expect(rendered(page)).toBeVisible();
  });

  test('an HTML preview switches to the source', async ({ page }) => {
    await open(page, { name: 'page.html', bytes: '<!doctype html><title>T</title><p>Hello</p>\n' });
    await page.keyboard.press('ControlOrMeta+Alt+3');
    await expect(page.locator('.document:not([hidden]) .html-preview-frame')).toBeVisible();
    await runCommand(page, 'Find…');
    await expect(findField(page)).toBeFocused();
    await expect(page.locator('.document:not([hidden]) .html-preview-frame')).toBeHidden();
  });
});

const TABLE = 'nom;poble\nAnna;Barcelona\nBernat;Girona\n"Bàrbara";Sabadell\nCarles;barcelona\n';

test.describe('in a table', () => {
  test('finds values, moves between them with Enter and Shift+Enter, and highlights them @cross', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: TABLE });
    await cell(page, 0, 0).click();
    await page.keyboard.press('ControlOrMeta+F');
    await expect(query(page)).toBeFocused();
    await page.keyboard.type('bar');
    await expect(status(page)).toHaveText('3 matches');
    await expect(page.locator('.document:not([hidden]) .cell.found')).toHaveCount(3);
    await page.keyboard.press('Enter');
    await expect(status(page)).toHaveText('1 of 3');
    await expect(active(page)).toHaveText('Barcelona');
    await expect(active(page)).toHaveClass(/current/);
    await page.keyboard.press('Enter');
    await expect(active(page)).toHaveText('Bàrbara');
    await page.keyboard.press('Enter');
    await expect(active(page)).toHaveText('barcelona');
    await page.keyboard.press('Enter');
    await expect(status(page)).toHaveText('1 of 3');
    await page.keyboard.press('Shift+Enter');
    await expect(status(page)).toHaveText('3 of 3');
    // The typing stays in the field the whole time.
    await expect(query(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(bar(page)).toHaveCount(0);
    await expect(page.locator('.document:not([hidden]) .cell.found')).toHaveCount(0);
    await expect(page.getByTestId('grid-input')).toBeFocused();
  });

  test('matches case, whole cells and the selected columns when asked', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: 'a;b;c\nbar;bar;Bar\nbarra;x;bar\n' });
    await page.keyboard.press('ControlOrMeta+F');
    await expect(query(page)).toBeFocused();
    await page.keyboard.type('bar');
    await expect(status(page)).toHaveText('5 matches');
    await bar(page).getByLabel('Match case').check();
    await expect(status(page)).toHaveText('4 matches');
    await bar(page).getByLabel('Whole cell').check();
    await expect(status(page)).toHaveText('3 matches');
    // Only column C, selected by its header.
    await page.locator('.document:not([hidden]) [data-testid=col-head]').nth(2).click();
    await page.getByTestId('grid-find-columns').check();
    await expect(bar(page)).toContainText('Columns C');
    await expect(status(page)).toHaveText('1 match');
    await bar(page).getByLabel('Match case').uncheck();
    await expect(status(page)).toHaveText('2 matches');
  });

  test('Replace changes one cell at a time, and Replace All is one undo step @cross', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: TABLE });
    await page.keyboard.press('ControlOrMeta+Alt+F');
    await expect(replacement(page)).toBeFocused();
    await query(page).fill('barcelona');
    await replacement(page).fill('BCN');
    await expect(status(page)).toHaveText('2 matches');
    // The first Replace only shows the match, as editors do; the second replaces it.
    await replacement(page).press('Enter');
    await expect(active(page)).toHaveText('Barcelona');
    await replacement(page).press('Enter');
    await expect(cell(page, 1, 1)).toHaveText('BCN');
    await expect(active(page)).toHaveText('barcelona');
    await expectDirty(page);

    await query(page).fill('a');
    await replacement(page).fill('4');
    await bar(page).getByRole('button', { name: 'Replace all' }).click();
    await expect(status(page)).toHaveText('Replaced 7 cells');
    await expect(cell(page, 3, 0)).toHaveText('Bàrb4r4');
    await expect(cell(page, 4, 1)).toHaveText('b4rcelon4');
    // One undo for all of it, and one more for the first replace.
    await page.getByTestId('grid-input').focus();
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(cell(page, 3, 0)).toHaveText('Bàrbara');
    await expect(cell(page, 1, 1)).toHaveText('BCN');
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(cell(page, 1, 1)).toHaveText('Barcelona');
    await expectClean(page);
  });

  test('Replace All keeps the quoting and everything it did not touch', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: TABLE.replace(/\n/g, '\r\n') });
    await runCommand(page, 'Find and replace…');
    await query(page).fill('barcelona');
    await replacement(page).fill('Lleida');
    await bar(page).getByRole('button', { name: 'Replace all' }).click();
    await expect(status(page)).toHaveText('Replaced 2 cells');
    const saved = (await downloadSaved(page)).toString();
    expect(saved).toBe('nom;poble\r\nAnna;Lleida\r\nBernat;Girona\r\n"Bàrbara";Sabadell\r\nCarles;Lleida\r\n');
  });

  test('the bar searches rows that are not drawn', async ({ page }) => {
    const rows = ['id;nom'];
    for (let i = 0; i < 5000; i++) rows.push(`${i};Persona ${i}`);
    await open(page, { name: 'big.csv', bytes: rows.join('\n') + '\n' });
    await expect(cell(page, 4999, 1)).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+F');
    await expect(query(page)).toBeFocused();
    await page.keyboard.type('persona 4999');
    await page.keyboard.press('Enter');
    await expect(status(page)).toHaveText('1 of 1');
    await expect(cell(page, 5000, 1)).toHaveClass(/current/);
  });
});

// The Mac app's smallest window, half of a MacBook Air's screen or less.
test('the table bar fits a 560 by 420 window and leaves room for the table @cross', async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 420 });
  await open(page, { name: 'a.csv', bytes: TABLE });
  await page.keyboard.press('ControlOrMeta+Alt+F');
  await expect(replacement(page)).toBeFocused();
  await query(page).fill('bar');
  await expect(status(page)).toHaveText('3 matches');
  for (const control of [
    query(page),
    replacement(page),
    status(page),
    page.getByTestId('grid-find-columns'),
    bar(page).getByRole('button', { name: 'Replace all' }),
    bar(page).getByRole('button', { name: 'Close' }),
  ]) {
    await expect(control).toBeInViewport({ ratio: 1 });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(560);
  const grid = await page.locator('.document:not([hidden]) [data-testid=grid]').boundingBox();
  expect(grid!.height).toBeGreaterThan(150);
  await expect(cell(page, 4, 1)).toBeInViewport();
  await page.screenshot({ path: 'test-results/find-bar-560.png' });
});

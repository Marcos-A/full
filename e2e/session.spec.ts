import { expect, Page, test } from '@playwright/test';
import { crashAndReopen, downloadSaved, expectDirty, idbRecords, open, rendered, settle, source, useDownloads } from './helpers';

const names = (page: Page) => page.locator('.tab-name');
const activeTab = (page: Page) => page.locator('.tab.active .tab-name');

test.beforeEach(async ({ page }) => {
  await useDownloads(page);
  await page.goto('/');
});

test('reopens every tab in order, with the same one in front, its marks and its view @cross', async ({ page }) => {
  await open(page, { name: 'a.md', bytes: '# A\n\nalpha\n' });
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('typed');
  await page.keyboard.press('ControlOrMeta+Alt+2');
  await open(page, { name: 'b.csv', bytes: 'x;y\r\n1;2\r\n' });
  await open(page, { name: 'c.txt', bytes: 'plain\n' });
  await page.getByTestId('tab').nth(1).locator('.tab-name').click();
  await settle(page);
  await page.reload();

  await expect(names(page)).toHaveText([/a\.md$/, 'b.csv', 'c.txt']);
  await expect(activeTab(page)).toHaveText('b.csv');
  await expect(page.getByTestId('dirty')).toHaveCount(1);
  await expect(page.getByTestId('recovery-entry')).toHaveCount(0);
  await page.getByTestId('tab').first().locator('.tab-name').click();
  await expect(source(page)).toContainText('typed');
  await expectDirty(page);
  await expect(page.locator('.document:not([hidden]) [data-testid=rendered]')).toBeHidden();
  expect((await downloadSaved(page)).toString()).toBe('# A\n\nalpha\ntyped');
  await page.getByTestId('tab').nth(2).locator('.tab-name').click();
  expect((await downloadSaved(page)).toString()).toBe('plain\n');
});

test('puts the cursor and the scroll position back @cross', async ({ page }) => {
  const lines = Array.from({ length: 400 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
  await open(page, { name: 'long.txt', bytes: lines });
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let i = 0; i < 300; i++) await page.keyboard.press('ArrowDown');
  await settle(page);
  await page.reload();
  await expect(page.locator('.cm-line', { hasText: /^line 301$/ })).toBeInViewport();
  await expect(page.locator('.cm-line', { hasText: /^line 1$/ })).toHaveCount(0);
  await source(page).focus();
  await page.keyboard.type('X');
  await expect(page.locator('.cm-line', { hasText: /^Xline 301$/ })).toHaveCount(1);
});

test('closing the files first leaves nothing to reopen', async ({ page }) => {
  await open(page, { name: 'a.txt', bytes: 'a\n' });
  await page.keyboard.press('Alt+W');
  await page.reload();
  await expect(page.getByTestId('empty')).toBeVisible();
});

test('a crash leaves the files in the recovery list instead', async ({ page }) => {
  await open(page, { name: 'a.txt', bytes: 'a\n' });
  await settle(page);
  await crashAndReopen(page);
  await expect(page.getByTestId('tab')).toHaveCount(0);
  await expect(page.getByTestId('recovery-entry')).toContainText('a.txt');
});

test('only the most recently closed page reopens; the other waits in the list @cross', async ({ context }) => {
  const first = await context.newPage();
  await first.goto('/');
  await open(first, { name: 'first.txt', bytes: '1\n' });
  const second = await context.newPage();
  await second.goto('/');
  await open(second, { name: 'second.txt', bytes: '2\n' });
  await settle(second);
  await first.close();
  await second.close();
  const next = await context.newPage();
  await next.goto('/');
  await expect(names(next)).toHaveText(['second.txt']);
  await expect(next.getByTestId('recovery-banner')).toContainText('1 file');
});

test('two pages opening at once take each file once @cross', async ({ context }) => {
  const leaving = await context.newPage();
  await leaving.goto('/');
  await open(leaving, { name: 'a.txt', bytes: 'a\n' });
  await open(leaving, { name: 'b.txt', bytes: 'b\n' });
  await settle(leaving);
  await leaving.close();
  const [one, two] = [await context.newPage(), await context.newPage()];
  await Promise.all([one.goto('/'), two.goto('/')]);
  await expect.poll(async () => (await one.getByTestId('tab').count()) + (await two.getByTestId('tab').count())).toBe(2);
  await settle(one);
  const all = [...(await names(one).allTextContents()), ...(await names(two).allTextContents())].sort();
  expect(all).toEqual(['a.txt', 'b.txt']);
  expect(await one.getByTestId('recovery-entry').count()).toBe(0);
  expect(await two.getByTestId('recovery-entry').count()).toBe(0);
});

test('a Markdown view and a table come back as they were left', async ({ page }) => {
  await open(page, { name: 'n.md', bytes: '# N\n' });
  await rendered(page).locator('h1').waitFor();
  await page.keyboard.press('ControlOrMeta+Alt+3');
  await open(page, { name: 't.csv', bytes: 'a;b\r\n1;2\r\n' });
  await page.getByTestId('tab').first().locator('.tab-name').click();
  await settle(page);
  await page.reload();
  await expect(rendered(page).locator('h1')).toHaveText('N');
  await expect(page.locator('.document:not([hidden]) [data-testid=source]')).toBeHidden();
});

test('"Clear all recovery data" also forgets the session', async ({ page }) => {
  await open(page, { name: 'a.txt', bytes: 'a\n' });
  await settle(page);
  await crashAndReopen(page);
  await expect(page.getByTestId('recovery-entry')).toHaveCount(1);
  await page.getByTestId('recovery-list').getByRole('button', { name: 'Clear all recovery data' }).click();
  await page.getByTestId('dialog').getByRole('button', { name: 'Clear all recovery data' }).click();
  await expect.poll(() => idbRecords(page)).toEqual([]);
  await page.reload();
  await expect(page.getByTestId('empty')).toBeVisible();
  await settle(page);
  await expect(page.getByTestId('tab')).toHaveCount(0);
  await expect(page.getByTestId('recovery-entry')).toHaveCount(0);
});

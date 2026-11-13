import { expect, test } from '@playwright/test';
import { open, rendered, source } from './helpers';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

const panes = (page: import('@playwright/test').Page) => ({
  source: page.locator('.document:not([hidden]) [data-testid=source]'),
  rendered: page.locator('.document:not([hidden]) [data-testid=rendered]'),
});

test('Alt+1, 2 and 3 switch the Markdown views from either side @cross', async ({ page }) => {
  await open(page, { name: 'a.md', bytes: '# Title\n\nText\n' });
  await rendered(page).locator('h1').waitFor();
  const { source: sourcePane, rendered: renderedPane } = panes(page);
  await source(page).click();
  await page.keyboard.press('Alt+3');
  await expect(sourcePane).toBeHidden();
  await expect(renderedPane).toBeVisible();
  // The rendered side now has the focus, and the keys still work from there.
  await expect(rendered(page)).toBeFocused();
  await page.keyboard.press('Alt+2');
  await expect(renderedPane).toBeHidden();
  await expect(sourcePane).toBeVisible();
  await expect(source(page)).toBeFocused();
  await page.keyboard.press('Alt+1');
  await expect(sourcePane).toBeVisible();
  await expect(renderedPane).toBeVisible();
  // Nothing was typed into the file by the key presses.
  await expect(page.getByTestId('dirty')).toHaveCount(0);
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
  await page.keyboard.press('Alt+3');
  await expect(panes(page).source).toBeVisible();
  await expect(page.getByTestId('dirty')).toHaveCount(0);
});

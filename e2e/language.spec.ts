import { expect, Page, test } from '@playwright/test';
import { expectDirty, open, rendered, runCommand, source, sourceText } from './helpers';

const storedLanguage = (page: Page) => page.evaluate(() => localStorage.getItem('full.language'));

test.describe('in an English browser', () => {
  test('the interface is English', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByTestId('empty').getByRole('button', { name: 'New file' })).toBeVisible();
  });

  test('switching to Catalan is immediate, remembered and keeps the open files', async ({ page }) => {
    await page.goto('/');
    await open(page, { name: 'a.md', bytes: '# Hi\n' });
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('more');
    await expectDirty(page);

    await runCommand(page, 'Language: Català');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ca');
    await expect(page.getByTestId('menu-button')).toHaveAttribute('aria-label', 'Ordres');
    await expect(source(page)).toHaveAttribute('aria-label', 'Codi font');
    await expect(rendered(page)).toHaveAttribute('aria-label', 'Markdown amb format');
    await expect(rendered(page).locator('h1')).toHaveText('Hi');
    expect(await sourceText(page)).toBe('# Hi\nmore');
    await expectDirty(page);
    expect(await storedLanguage(page)).toBe('ca');

    await runCommand(page, 'Tanca el fitxer');
    await page.getByTestId('dialog').getByRole('button', { name: 'No desis' }).click();
    await page.reload();
    await expect(page.getByTestId('empty').getByRole('button', { name: 'Fitxer nou' })).toBeVisible();
  });

  test('choosing the browser language again goes back to following the browser', async ({ page }) => {
    await page.goto('/');
    await runCommand(page, 'Language: Català');
    await runCommand(page, 'Idioma: English');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    expect(await storedLanguage(page)).toBeNull();
  });

  test('the start screen and the menu tooltip point to the palette', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('commands-hint')).toHaveText(/(Ctrl\+|⌘)K: all commands/);
    await open(page, { name: 'a.txt', bytes: 'x\n' });
    await expect(page.getByTestId('commands-hint')).toHaveCount(0);
    await expect(page.getByTestId('menu-button')).toHaveAttribute('title', /Commands \((Ctrl\+|⌘)K\)/);
  });

  test('the language label opens the palette on just the languages, even on the start screen', async ({ page }) => {
    await page.goto('/');
    const label = page.getByTestId('language-button');
    await expect(label).toHaveText('EN');
    await expect(label).toHaveAttribute('aria-label', 'Change language (EN)');
    await label.click();
    const options = page.getByTestId('palette').getByRole('option');
    await expect(options).toHaveCount(2);
    await options.filter({ hasText: 'Català' }).click();
    await expect(page.getByTestId('palette')).toHaveCount(0);
    await expect(label).toHaveText('CA');
    await expect(page.getByTestId('commands-hint')).toHaveText(/totes les ordres/);
  });

  test('the search panel and image placeholders follow a switch', async ({ page }) => {
    await page.goto('/');
    await open(page, { name: 'a.md', bytes: '![x](https://example.com/a.png)\n' });
    await expect(rendered(page)).toContainText('Remote image blocked');
    await runCommand(page, 'Language: Català');
    await expect(rendered(page)).toContainText('Imatge remota bloquejada');
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+F');
    await expect(page.getByPlaceholder('Cerca')).toBeVisible();
  });
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true });

  test('the keyboard hint is hidden, and the language label still works', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('empty').waitFor();
    await expect(page.getByTestId('commands-hint')).toBeHidden();
    await page.getByTestId('language-button').tap();
    await expect(page.getByTestId('palette').getByRole('option')).toHaveCount(2);
  });
});

test.describe('in a Catalan browser', () => {
  test.use({ locale: 'ca-ES' });

  test('the interface is Catalan without being asked', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'ca');
    await expect(page.getByTestId('empty').getByRole('button', { name: 'Fitxer nou' })).toBeVisible();
    expect(await storedLanguage(page)).toBeNull();
  });

  test('a stored choice of English wins, and survives a reload', async ({ page }) => {
    await page.goto('/');
    await runCommand(page, 'Idioma: English');
    expect(await storedLanguage(page)).toBe('en');
    await page.reload();
    await expect(page.getByTestId('empty').getByRole('button', { name: 'New file' })).toBeVisible();
  });

  test('tables are labelled in Catalan, with Catalan number formatting', async ({ page }) => {
    await page.goto('/');
    await open(page, { name: 'a.csv', bytes: 'a;b\n'.repeat(1000) });
    await expect(page.getByTestId('status-counts')).toHaveText('1.000 files × 2 columnes');
    await expect(page.getByRole('grid', { name: 'Taula CSV' })).toBeVisible();
    await expect(page.getByTestId('status-delimiter')).toHaveText('punt i coma');
  });

  test('status bar shortcuts find the Catalan commands', async ({ page }) => {
    await page.goto('/');
    await open(page, { name: 'a.csv', bytes: 'a;b\n' });
    const options = page.getByTestId('palette').getByRole('option');
    const firstOption = options.first();
    await page.getByTestId('language-button').click();
    await expect(options).toHaveCount(2);
    await expect(firstOption).toContainText('Idioma: ');
    await page.keyboard.press('Escape');
    await page.getByTestId('status-delimiter').click();
    await expect(firstOption).toContainText('Delimitador CSV');
    await page.keyboard.press('Escape');
    await page.getByTestId('status-encoding').click();
    await expect(firstOption).toContainText('Torna a obrir amb la codificació');
    await page.keyboard.press('Escape');
    await page.getByTestId('accent-button').click();
    await expect(firstOption).toContainText('Accent: ');
  });
});

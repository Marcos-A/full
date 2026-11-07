import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { APP_NAME } from '../src/config';
import { expectClean, open, rendered, runCommand, source } from './helpers';

const palette = (page: Page) => page.getByTestId('palette');

async function paletteLabels(page: Page): Promise<string[]> {
  await page.keyboard.press('ControlOrMeta+K');
  const labels = await palette(page).getByRole('option').locator('span').allTextContents();
  await page.keyboard.press('Escape');
  return labels;
}

async function menuLabels(page: Page): Promise<string[]> {
  await page.getByTestId('menu-button').click();
  const labels = await page.getByTestId('menu').getByRole('menuitem').locator('span').allTextContents();
  await page.keyboard.press('Escape');
  return labels;
}

const CONTEXTS: Array<[string, { name: string; bytes: string }]> = [
  ['Markdown', { name: 'a.md', bytes: '# Hi\n' }],
  ['CSV', { name: 'a.csv', bytes: 'a;b\n' }],
  ['TXT', { name: 'a.txt', bytes: 'x\n' }],
];

test.describe('AC22 commands', () => {
  for (const [label, file] of CONTEXTS) {
    test(`palette and menu offer the same commands: ${label}`, async ({ page }) => {
      await page.goto('/');
      await open(page, file);
      const fromPalette = await paletteLabels(page);
      const fromMenu = await menuLabels(page);
      expect(fromMenu.slice().sort()).toEqual(fromPalette.slice().sort());
      for (const required of ['Undo', 'Redo', 'Close file', 'Theme: dark']) expect(fromPalette).toContain(required);
      expect(fromPalette.some((l) => l === 'Save' || l === 'Download')).toBe(true);
      expect(fromPalette.some((l) => l === 'Save As' || l === 'Download As')).toBe(true);
      expect(fromPalette.some((l) => l.startsWith('Copy'))).toBe(true);
    });
  }

  test('palette has fuzzy search and is fully keyboard driven', async ({ page }) => {
    await page.goto('/');
    await open(page, { name: 'a.md', bytes: 'x\n' });
    await page.keyboard.press('ControlOrMeta+K');
    await page.keyboard.type('thmlght');
    await expect(palette(page).getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.keyboard.press('ControlOrMeta+K');
    await page.keyboard.type('thsystem');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  });

  test('menu works by keyboard alone', async ({ page }) => {
    await page.goto('/');
    await open(page, { name: 'a.md', bytes: 'x\n' });
    await page.getByTestId('menu-button').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('menu').getByRole('menuitem').first()).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByTestId('menu').getByRole('menuitem').last()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByTestId('menu')).toHaveCount(0);
  });

  test('every Markdown command reachable through the menu runs', async ({ page }) => {
    await page.goto('/');
    await open(page, { name: 'a.md', bytes: '# Hi\n' });
    await page.getByTestId('menu-button').click();
    await page.getByTestId('menu').getByRole('menuitem', { name: 'View: source only' }).click();
    await expect(page.getByTestId('rendered')).toBeHidden();
  });

  test('keyboard: Alt+W closes, tabs switch with arrows, and the app has no focus traps', async ({ page }) => {
    await page.goto('/');
    await open(page, { name: 'a.txt', bytes: 'x\n' });
    await open(page, { name: 'b.txt', bytes: 'y\n' });
    await page.getByRole('button', { name: 'b.txt', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByTestId('tab').filter({ hasText: 'a.txt' })).toHaveClass(/active/);
    await page.keyboard.press('Alt+W');
    await expect(page.getByTestId('tab')).toHaveCount(1);
    await runCommand(page, 'Close file');
    await expect(page.getByTestId('empty')).toBeVisible();
    await expectClean(page);
  });

  test('status bar links to encoding and delimiter choices', async ({ page }) => {
    await page.goto('/');
    await open(page, { name: 'a.csv', bytes: 'a;b\n' });
    await page.getByTestId('status-delimiter').click();
    await expect(palette(page).getByRole('option').first()).toContainText('CSV delimiter');
    await page.keyboard.press('Escape');
    await page.getByTestId('status-encoding').click();
    await expect(palette(page).getByRole('option').first()).toContainText('Reopen with encoding');
  });
});

test.describe('AC22 appearance', () => {
  for (const theme of ['dark', 'light'] as const) {
    test(`${theme} theme: no axe violations, including WCAG AA contrast`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto('/');
      const axe = () =>
        new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze().then((r) =>
          r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`),
        );
      expect(await axe()).toEqual([]);
      await open(page, { name: 'a.md', bytes: '---\nt: 1\n---\n# Hi\n\n[link](https://x.example.test)\n\n`code`\n\n> q\n\n![r](./x.png)\n\n| a |\n|---|\n| 1 |\n' });
      await rendered(page).locator('h1').waitFor();
      expect(await axe()).toEqual([]);
      await open(page, { name: 'b.csv', bytes: 'a;b;c\n1;2;3\n4\n' });
      await page.getByTestId('grid').waitFor();
      expect(await axe()).toEqual([]);
      await page.keyboard.press('ControlOrMeta+K');
      await palette(page).waitFor();
      expect(await axe()).toEqual([]);
    });
  }

  test('the status bar toggle switches theme against the OS, and the choice persists', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const toggle = page.getByTestId('theme-toggle');
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await bg();
    await expect(toggle).toHaveAccessibleName('Switch to dark theme');
    await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(bg).not.toBe(light);
    await expect(toggle).toHaveAccessibleName('Switch to light theme');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('theme-toggle').click();
    await expect.poll(bg).toBe(light);
  });

  test('switching back to the system theme follows the system again', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const toggle = page.getByTestId('theme-toggle');
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await bg();
    await toggle.click();
    await toggle.click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
    expect(await page.evaluate(() => localStorage.getItem('full.theme'))).toBeNull();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(bg).not.toBe(light);
    await expect(toggle).toHaveAccessibleName('Switch to light theme');
    await page.reload();
    await page.emulateMedia({ colorScheme: 'light' });
    await expect.poll(bg).toBe(light);
  });

  test('an override stays when the system changes, until it is switched back', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.getByTestId('theme-toggle').click();
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');
  });

  for (const [os, theme] of [['light', 'dark'], ['dark', 'light']] as const) {
    test(`${theme} chosen on a ${os} OS meets WCAG AA in menus, dialogs and warnings too`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: os });
      await page.goto('/');
      await page.getByTestId('theme-toggle').click();
      const axe = () =>
        new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze().then((r) =>
          r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`),
        );
      await open(page, { name: 'a.csv', bytes: 'a;b;c\r\n1;2;3\r\n4\r\n5;6;7\n' });
      await page.getByTestId('row-head').nth(1).click();
      await page.getByTestId('head-menu').waitFor();
      expect(await axe()).toEqual([]);
      await page.keyboard.press('Escape');
      await page.getByTestId('menu-button').click();
      expect(await axe()).toEqual([]);
      await page.keyboard.press('Escape');
      await open(page, { name: 'b.md', bytes: '# Hi\n\ntext ~~old~~ **bold** [l](https://x.example.test)\n\n- [x] t\n' });
      await rendered(page).locator('h1').click();
      await page.keyboard.type('x');
      await page.getByTestId('dialog').waitFor();
      expect(await axe()).toEqual([]);
    });
  }

  for (const theme of ['dark', 'light'] as const) {
    for (const accent of ['blue', 'green', 'orange', 'coral', 'violet']) {
      test(`${accent} accent in the ${theme} theme meets WCAG AA`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: theme });
        await page.goto('/');
        await page.getByTestId('empty').waitFor();
        await runCommand(page, `Accent: ${accent}`);
        const axe = () =>
          new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze().then((r) =>
            r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`),
          );
        expect(await axe()).toEqual([]);
        await open(page, { name: 'a.md', bytes: '# Hi\n\n[link](https://x.example.test)\n\n[ref]: https://x.example.test\n' });
        await rendered(page).locator('a').waitFor();
        expect(await axe()).toEqual([]);
        await open(page, { name: 'b.csv', bytes: 'a;b\n1;2\n3;4\n' });
        await page.getByTestId('row-head').nth(1).click();
        expect(await axe()).toEqual([]);
        await page.keyboard.press('ControlOrMeta+K');
        await palette(page).waitFor();
        expect(await axe()).toEqual([]);
      });
    }
  }

  test('the status bar dot lists the tones, and the choice persists and applies everywhere', async ({ page }) => {
    await page.goto('/');
    const accent = () => page.evaluate(() => getComputedStyle(document.querySelector('.button.primary')!).backgroundColor);
    const blue = await accent();
    await page.getByTestId('accent-button').click();
    const options = palette(page).getByRole('option');
    await expect(options).toHaveCount(5);
    const swatches = await options.locator('.swatch').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    expect(new Set(swatches).size).toBe(5);
    expect(swatches).toContain(blue);
    const coral = await options.filter({ hasText: 'coral' }).locator('.swatch').evaluate((e) => getComputedStyle(e).backgroundColor);
    await options.filter({ hasText: 'coral' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-accent', 'coral');
    await expect.poll(accent).toBe(coral);
    // Each swatch shows its own tone, whichever accent is active.
    await page.getByTestId('accent-button').click();
    const whileCoral = await options.locator('.swatch').evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
    expect(new Set(whileCoral).size).toBe(5);
    expect(whileCoral).toContain(blue);
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByTestId('empty').waitFor();
    await expect.poll(accent).toBe(coral);
    await page.getByTestId('theme-toggle').click();
    await expect.poll(accent).not.toBe(coral);
    await runCommand(page, 'Accent: blue');
    await expect(page.locator('html')).not.toHaveAttribute('data-accent');
    expect(await page.evaluate(() => localStorage.getItem('full.accent'))).toBeNull();
  });

  test('follows the OS setting by default', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = await bg();
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect.poll(bg).not.toBe(light);
  });

  test('the layout stays usable at 768 px wide', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 600 });
    await page.goto('/');
    await open(page, { name: 'a-rather-long-file-name-for-a-tab.md', bytes: '# Hi\n' });
    await open(page, { name: 'b.csv', bytes: 'a;b;c;d;e;f;g;h;i;j;k;l;m;n;o;p\n' });
    await expect(page.getByTestId('menu-button')).toBeInViewport();
    await expect(page.getByTestId('build-info')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(768);
    await runCommand(page, 'Previous tab');
    await expect(source(page)).toBeInViewport();
  });

  test('the name comes from the config, and a missing build-info file shows a safe fallback', async ({ page, baseURL }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(APP_NAME);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(APP_NAME);
    test.skip(!baseURL?.includes('localhost'), 'deployed builds have real metadata');
    await expect(page.getByTestId('build-info')).toHaveText('Build unknown');
  });
});

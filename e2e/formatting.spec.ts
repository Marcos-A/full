import AxeBuilder from '@axe-core/playwright';
import { expect, Page, test } from '@playwright/test';
import { downloadSaved, expectClean, open, rendered, runCommand, settle, source, sourceText, useDownloads } from './helpers';

test.beforeEach(async ({ page }) => {
  await useDownloads(page);
  await page.goto('/');
});

/** Opens a Markdown file and selects `from` to `to` (character offsets) on the source side. */
async function select(page: Page, from: number, to = from) {
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let i = 0; i < from; i++) await page.keyboard.press('ArrowRight');
  for (let i = from; i < to; i++) await page.keyboard.press('Shift+ArrowRight');
}

async function openMarkdown(page: Page, text: string, viewSource = true) {
  await open(page, { name: 'notes.md', bytes: text });
  await rendered(page).locator('*').first().waitFor();
  if (viewSource) await page.keyboard.press('ControlOrMeta+Alt+2');
}

const cases: Array<{ name: string; text: string; from: number; to?: number; keys: string; expected: string }> = [
  { name: 'bold wraps a word', text: 'say hello now\n', from: 4, to: 9, keys: 'ControlOrMeta+B', expected: 'say **hello** now\n' },
  { name: 'bold unwraps it again', text: 'say **hello** now\n', from: 6, to: 11, keys: 'ControlOrMeta+B', expected: 'say hello now\n' },
  { name: 'bold unwraps a selection with its markers', text: 'say **hello** now\n', from: 4, to: 13, keys: 'ControlOrMeta+B', expected: 'say hello now\n' },
  { name: 'bold keeps spaces outside the markers', text: 'say hello now\n', from: 3, to: 10, keys: 'ControlOrMeta+B', expected: 'say **hello** now\n' },
  { name: 'italic inside bold makes both', text: '**hello**\n', from: 2, to: 7, keys: 'ControlOrMeta+I', expected: '***hello***\n' },
  { name: 'italic follows the file\'s underscores', text: 'an _old_ one\nnew\n', from: 13, to: 16, keys: 'ControlOrMeta+I', expected: 'an _old_ one\n_new_\n' },
  { name: 'inline code', text: 'run ls now\n', from: 4, to: 6, keys: 'ControlOrMeta+E', expected: 'run `ls` now\n' },
  { name: 'empty bold puts the cursor inside', text: 'a \n', from: 2, keys: 'ControlOrMeta+B', expected: 'a ****\n' },
  { name: 'heading cycles from text', text: 'Title\n', from: 2, keys: 'ControlOrMeta+Alt+H', expected: '# Title\n' },
  { name: 'heading cycles to the next level', text: '## Title\n', from: 4, keys: 'ControlOrMeta+Alt+H', expected: '### Title\n' },
  { name: 'heading cycles back to text after H3', text: '### Title\n', from: 5, keys: 'ControlOrMeta+Alt+H', expected: 'Title\n' },
  { name: 'bullets on each selected line', text: 'one\ntwo\n\nthree\n', from: 0, to: 14, keys: 'ControlOrMeta+Shift+8', expected: '- one\n- two\n\n- three\n' },
  { name: 'bullets follow the file\'s stars', text: '* a\n\nb\n', from: 5, keys: 'ControlOrMeta+Shift+8', expected: '* a\n\n* b\n' },
  { name: 'bullets start a list on an empty line', text: 'a\n\nb\n', from: 2, keys: 'ControlOrMeta+Shift+8', expected: 'a\n- \nb\n' },
  { name: 'bullets come off again', text: '- one\n- two\n', from: 0, to: 11, keys: 'ControlOrMeta+Shift+8', expected: 'one\ntwo\n' },
  { name: 'numbers on each line, and bullets become numbers', text: '- one\ntwo\n', from: 0, to: 9, keys: 'ControlOrMeta+Shift+7', expected: '1. one\n2. two\n' },
  { name: 'quote keeps blank lines inside it', text: 'one\n\ntwo\n', from: 0, to: 8, keys: 'ControlOrMeta+Shift+9', expected: '> one\n>\n> two\n' },
  { name: 'quote comes off', text: '> one\n>\n> two\n', from: 0, to: 13, keys: 'ControlOrMeta+Shift+9', expected: 'one\n\ntwo\n' },
  { name: 'code block around lines', text: 'a\nb\n', from: 0, to: 3, keys: 'ControlOrMeta+Shift+E', expected: '```\na\nb\n```\n' },
  { name: 'code block follows the file\'s tildes', text: '~~~\nx\n~~~\n\ny\n', from: 11, keys: 'ControlOrMeta+Shift+E', expected: '~~~\nx\n~~~\n\n~~~\ny\n~~~\n' },
  { name: 'code block comes off from inside', text: '```\na\n```\n', from: 4, keys: 'ControlOrMeta+Shift+E', expected: 'a\n' },
  { name: 'link around text, cursor in the address', text: 'see docs\n', from: 4, to: 8, keys: 'ControlOrMeta+Alt+K', expected: 'see [docs]()\n' },
  { name: 'link around an address', text: 'https://a.test\n', from: 0, to: 14, keys: 'ControlOrMeta+Alt+K', expected: '[](https://a.test)\n' },
];

test.describe('formatting on the source side', () => {
  for (const { name, text, from, to, keys, expected } of cases) {
    test(`${name} @cross`, async ({ page }) => {
      await openMarkdown(page, text);
      await select(page, from, to);
      await page.keyboard.press(keys);
      expect(await sourceText(page)).toBe(expected);
      // One undo restores the exact previous text.
      await page.keyboard.press('ControlOrMeta+Z');
      expect(await sourceText(page)).toBe(text);
    });
  }

  test('the cursor lands where typing continues', async ({ page }) => {
    await openMarkdown(page, 'a \n');
    await select(page, 2);
    await page.keyboard.press('ControlOrMeta+B');
    await page.keyboard.type('bold');
    await page.keyboard.press('ControlOrMeta+Alt+K');
    expect(await sourceText(page)).toBe('a **bold[]()**\n');
  });

  test('everything else stays byte for byte', async ({ page }) => {
    const text = 'keep\r\n  * odd  \r\nthis line\r\n';
    await openMarkdown(page, text);
    await select(page, 15, 19);
    await page.keyboard.press('ControlOrMeta+B');
    await settle(page);
    expect((await downloadSaved(page)).toString()).toBe('keep\r\n  * odd  \r\n**this** line\r\n');
  });

  test('the keys do nothing in other files, and Option+B still types there @cross', async ({ page }) => {
    await open(page, { name: 'a.txt', bytes: 'word\n' });
    await select(page, 0, 4);
    await page.keyboard.press('ControlOrMeta+Shift+8');
    expect(await sourceText(page)).toBe('word\n');
    await page.keyboard.press('Alt+B');
    await expect(page.getByTestId('format-bar')).toHaveCount(0);
  });
});

test.describe('formatting on the rendered side', () => {
  test('asks about reformatting first, then formats there and in the source @cross', async ({ page }) => {
    await openMarkdown(page, 'say hello\n', false);
    await rendered(page).locator('p').click();
    await page.keyboard.press('ControlOrMeta+B');
    await expect(page.getByTestId('dialog')).toBeVisible();
    await expect(rendered(page).locator('strong')).toHaveCount(0);
    await page.getByTestId('dialog').getByRole('button', { name: 'Continue' }).click();
    await rendered(page).locator('p').click();
    await page.keyboard.press('End');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('ControlOrMeta+B');
    await expect(rendered(page).locator('strong')).toHaveText('say hello');
    await expect.poll(() => sourceText(page)).toBe('**say hello**\n');
  });

  test('the same keys make a list and a heading', async ({ page }) => {
    await openMarkdown(page, 'item\n', false);
    await page.evaluate(() => localStorage.setItem('full.skipReformatWarning', '1'));
    await rendered(page).locator('p').click();
    await page.keyboard.press('ControlOrMeta+Shift+8');
    await expect(rendered(page).locator('ul li')).toHaveText('item');
    await expect.poll(() => sourceText(page)).toMatch(/^[-*] item\n$/);
    await page.keyboard.press('ControlOrMeta+Shift+8');
    await expect(rendered(page).locator('ul')).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+Alt+H');
    await expect(rendered(page).locator('h1')).toHaveText('item');
  });
});

test.describe('the formatting bar', () => {
  test('is hidden until Alt+B, then remembered, and only shows for Markdown @cross', async ({ page }) => {
    await openMarkdown(page, 'hello\n');
    await expect(page.getByTestId('format-bar')).toHaveCount(0);
    await page.keyboard.press('Alt+B');
    const bar = page.getByTestId('format-bar');
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('button')).toHaveCount(9);
    await expect(bar.getByRole('button', { name: 'Bold' })).toHaveAttribute('title', /^Bold \((⌘B|Ctrl\+B)\)$/);
    // The file comes back by itself, and so does the bar.
    await page.reload();
    await expect(page.locator('.tab-name')).toHaveText(['notes.md']);
    await expect(page.getByTestId('format-bar')).toBeVisible();
    await open(page, { name: 'data.csv', bytes: 'a,b\n' });
    await expect(page.getByTestId('format-bar')).toHaveCount(0);
    await page.getByTestId('tab').first().locator('.tab-name').click();
    await expect(page.getByTestId('format-bar')).toBeVisible();
    await runCommand(page, 'Hide formatting bar');
    await expect(page.getByTestId('format-bar')).toHaveCount(0);
  });

  test('a button formats the selection without taking the focus', async ({ page }) => {
    await openMarkdown(page, 'say hello\n');
    await page.keyboard.press('Alt+B');
    await select(page, 4, 9);
    await page.getByTestId('format-bar').getByRole('button', { name: 'Bold' }).click();
    expect(await sourceText(page)).toBe('say **hello**\n');
    await expect(source(page)).toBeFocused();
  });

  test('is one Tab stop with arrow keys inside, and passes the axe checks', async ({ page }) => {
    await openMarkdown(page, 'hello\n');
    await page.keyboard.press('Alt+B');
    const bar = page.getByTestId('format-bar');
    await expect(bar).toHaveAttribute('role', 'toolbar');
    await bar.getByRole('button', { name: 'Bold' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(bar.getByRole('button', { name: 'Italic' })).toBeFocused();
    await page.keyboard.press('End');
    await expect(bar.getByRole('button', { name: 'Link' })).toBeFocused();
    await expect(bar.locator('button[tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await expect(source(page)).toBeFocused();
    const violations = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(violations.violations.map((v) => v.id)).toEqual([]);
    await expectClean(page);
  });

  test.describe('in Catalan', () => {
    test.use({ locale: 'ca-ES' });
    test('is labelled in Catalan', async ({ page }) => {
      await openMarkdown(page, 'hola\n');
      await page.keyboard.press('Alt+B');
      await expect(page.getByTestId('format-bar').getByRole('button', { name: 'Negreta' })).toBeVisible();
      await expect(page.getByTestId('format-bar')).toHaveAttribute('aria-label', 'Format');
    });
  });
});

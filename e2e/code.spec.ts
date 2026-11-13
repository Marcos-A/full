import { expect, Page, test } from '@playwright/test';
import { downloadSaved, expectClean, open, rendered, runCommand, settle, source, sourceText, useDownloads } from './helpers';

test.beforeEach(async ({ page }) => {
  await useDownloads(page);
  await page.goto('/');
  await page.getByTestId('empty').waitFor();
});

const token = (page: Page, text: string) => source(page).locator('span').getByText(text, { exact: true }).first();
const color = (page: Page, text: string) => token(page, text).evaluate((el) => getComputedStyle(el).color);
const plainColor = (page: Page) => source(page).evaluate((el) => getComputedStyle(el).color);

async function expectColoured(page: Page, text: string): Promise<void> {
  await expect.poll(async () => (await token(page, text).count()) > 0 && (await color(page, text)) !== (await plainColor(page))).toBe(true);
}

const expectPlain = (page: Page) => expect(source(page).locator('.cm-line span')).toHaveCount(0);

/** Holds back the grammars. Everything else has loaded by the time the app is on screen. */
async function holdGrammars(page: Page): Promise<() => void> {
  let release = () => undefined as void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/assets/*.js', async (route) => {
    await gate;
    await route.continue();
  });
  return release;
}

const SAMPLES: Array<[string, string, string]> = [
  ['a.py', 'def f():\n    return 1\n', 'def'],
  ['a.js', 'const x = 1;\n', 'const'],
  ['a.mjs', 'const x = 1;\n', 'const'],
  ['a.jsx', 'const x = <b>hi</b>;\n', 'const'],
  ['a.ts', 'interface A {}\n', 'interface'],
  ['a.tsx', 'interface A {}\n', 'interface'],
  ['a.html', '<div class="x"></div>\n', 'div'],
  ['a.css', 'a { color: red; }\n', 'color'],
  ['a.c', 'int main(void) { return 0; }\n', 'return'],
  ['a.h', 'int f(void);\n', 'int'],
  ['a.cpp', 'class A {};\n', 'class'],
  ['a.java', 'class A {}\n', 'class'],
  ['a.rs', 'fn main() {}\n', 'fn'],
  ['a.go', 'func main() {}\n', 'func'],
  ['a.php', '<?php echo 1;\n', 'echo'],
  ['a.json', '{"a": 1}\n', '1'],
  ['a.yaml', 'a: "b"\n', '"b"'],
  ['a.xml', '<a b="c"/>\n', '"c"'],
  ['a.svg', '<svg width="1"/>\n', '"1"'],
  ['a.sh', 'if true; then echo; fi\n', 'if'],
  ['A.PY', 'def f(): pass\n', 'def'],
];

test('every language is coloured, and the file stays clean @cross', async ({ page }) => {
  for (const [name, bytes, word] of SAMPLES) {
    await open(page, { name, bytes });
    await expectColoured(page, word);
    await expect(page.getByTestId('status-kind')).toHaveText('Text');
    await expectClean(page);
    expect(await sourceText(page), name).toBe(bytes);
  }
  await expect(page.getByTestId('notice-error')).toHaveCount(0);
});

test('a webpage is coloured inside its script and style blocks, and PHP outside its tags', async ({ page }) => {
  await open(page, { name: 'a.html', bytes: '<style>a { color: red; }</style>\n<script>const x = 1;</script>\n' });
  await expectColoured(page, 'color');
  await expectColoured(page, 'const');
  await open(page, { name: 'b.php', bytes: '<div>x</div>\n<?php echo 1;\n' });
  await expectColoured(page, 'div');
  await expectColoured(page, 'echo');
});

test('text and unfamiliar files stay plain', async ({ page }) => {
  for (const name of ['a.txt', 'a.log', 'Makefile', 'a.constructor', '.py']) {
    await open(page, { name, bytes: 'def f(): return "x"\n' });
    await settle(page);
    await expectPlain(page);
  }
});

test('Markdown keeps its own look, including HTML inside it', async ({ page }) => {
  await open(page, { name: 'a.md', bytes: '# Title\n\n<div class="x">y</div>\n' });
  await settle(page);
  await expect(source(page).locator('span').getByText('div', { exact: true })).toHaveCount(0);
  await expectColoured(page, '#');
});

test('Markdown follows the accent tone, and code strings do not', async ({ page }) => {
  await open(page, { name: 'a.md', bytes: '# Title\n\nSome `snippet` here.\n\n> quoted\n' });
  await open(page, { name: 'b.py', bytes: 's = "text"\n' });
  await expectColoured(page, '"text"');
  const string = await color(page, '"text"');
  await runCommand(page, 'Previous tab');
  await settle(page);
  const look = async () => ({
    heading: await color(page, 'Title'),
    code: await color(page, 'snippet'),
    bar: await rendered(page).locator('blockquote').evaluate((el) => getComputedStyle(el).borderLeftColor),
  });
  const violet = await look();
  await runCommand(page, 'Accent: green');
  const green = await look();
  expect(green.heading).not.toBe(violet.heading);
  expect(green.code).not.toBe(violet.code);
  expect(green.bar).not.toBe(violet.bar);
  expect(green.bar).toBe(green.heading);
  expect(green.code).not.toBe(green.heading);
  await runCommand(page, 'Next tab');
  await expect.poll(() => color(page, '"text"')).toBe(string);
});

test('typing changes only what is typed @cross', async ({ page }) => {
  await open(page, { name: 'a.html', bytes: '<p></p>' });
  await expectColoured(page, 'p');
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await page.keyboard.type('<div>');
  await expect.poll(() => sourceText(page)).toBe('<p>\n<div></p>');

  await open(page, { name: 'a.py', bytes: '    def f():' });
  await expectColoured(page, 'def');
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('x');
  await expect.poll(() => sourceText(page)).toBe('    def f():\n    x');
});

test('saving a coloured file gives back the same bytes', async ({ page }) => {
  const bytes = Buffer.from('﻿def f():\r\n\treturn "é"\r\n', 'utf8');
  await open(page, { name: 'a.py', bytes });
  await expectColoured(page, 'def');
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('x');
  await page.keyboard.press('Backspace');
  await settle(page);
  await expectClean(page);
  await page.keyboard.type('#');
  expect(await downloadSaved(page)).toEqual(Buffer.concat([bytes, Buffer.from('#')]));
});

test('saving under another name changes the colours', async ({ page }) => {
  const saveAs = async (name: string) => {
    await page.keyboard.press('ControlOrMeta+Shift+S');
    const dialog = page.getByTestId('dialog');
    await dialog.getByRole('textbox').fill(name);
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download', exact: true }).click();
    await downloading;
    await expect(dialog).toHaveCount(0);
  };
  await open(page, { name: 'a.txt', bytes: 'def f(): pass\n' });
  await expectPlain(page);
  await source(page).click();
  await saveAs('a.py');
  await expectColoured(page, 'def');
  await saveAs('a.log');
  await expectPlain(page);
});

test('a slow grammar shows the file at once and colours it when it arrives @cross', async ({ page }) => {
  const release = await holdGrammars(page);
  await open(page, { name: 'a.py', bytes: 'def f(): pass\n' });
  await expect(source(page)).toContainText('def f()');
  await expectPlain(page);
  release();
  await expectColoured(page, 'def');
  await expectClean(page);
});

test('a grammar that arrives after the file was renamed or closed is ignored', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const release = await holdGrammars(page);
  await open(page, { name: 'a.py', bytes: 'def f(): pass\n' });
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Shift+S');
  await page.getByTestId('dialog').getByRole('textbox').fill('a.txt');
  const downloading = page.waitForEvent('download');
  await page.getByTestId('dialog').getByRole('button', { name: 'Download', exact: true }).click();
  await downloading;
  await open(page, { name: 'b.rs', bytes: 'fn main() {}\n' });
  await page.keyboard.press('Alt+W');
  await expect(page.getByTestId('tab')).toHaveCount(1);
  release();
  await settle(page);
  await expectPlain(page);
  expect(errors).toEqual([]);
});

test('a grammar that fails to load leaves the file plain and usable @cross', async ({ page }) => {
  await page.route('**/assets/*.js', (route) => route.abort());
  await open(page, { name: 'a.py', bytes: 'def f(): pass\n' });
  await settle(page);
  await expectPlain(page);
  await expect(page.getByTestId('notice-error')).toHaveCount(0);
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('x');
  await expect.poll(() => sourceText(page)).toBe('def f(): pass\nx');

  await page.unroute('**/assets/*.js');
  await open(page, { name: 'b.py', bytes: 'def f(): pass\n' });
  await expectColoured(page, 'def');
});

test('a file over the size limit, or with a very long line, opens without colours', async ({ page }) => {
  const line = 'const value = "text";\n';
  await open(page, { name: 'big.js', bytes: line.repeat(Math.ceil((1024 * 1024 + 1) / line.length)) });
  await expect(source(page)).toContainText('const value');
  await settle(page);
  await expectPlain(page);
  await open(page, { name: 'bundle.min.js', bytes: `const value = 1;${' '.repeat(10_000)}\n` });
  await expect(source(page)).toContainText('const value');
  await settle(page);
  await expectPlain(page);
  await open(page, { name: 'ok.js', bytes: `const value = 1;${' '.repeat(5_000)}\n` });
  await expectColoured(page, 'const');
});

async function typeInto(page: Page, name: string, bytes: string, keys: string): Promise<void> {
  await open(page, { name, bytes });
  await expectColoured(page, COLOURED_WORD[name]);
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(keys);
}

const COLOURED_WORD: Record<string, string> = { 'a.html': 'div', 'a.xml': '"c"', 'a.svg': '"1"', 'a.php': 'echo', 'a.jsx': 'const', 'a.txt': '' };

test('typing </ finishes the closing tag in markup files @cross', async ({ page }) => {
  await typeInto(page, 'a.html', '<div class="x"><p>a</p>', '</');
  await expect.poll(() => sourceText(page)).toBe('<div class="x"><p>a</p></div>');
  await typeInto(page, 'a.xml', '<a b="c"><ns:d>', '</');
  await expect.poll(() => sourceText(page)).toBe('<a b="c"><ns:d></ns:d>');
  await typeInto(page, 'a.svg', '<svg width="1"><g>', '</');
  await expect.poll(() => sourceText(page)).toBe('<svg width="1"><g></g>');
  await typeInto(page, 'a.php', '<?php echo 1; ?><div>', '</');
  await expect.poll(() => sourceText(page)).toBe('<?php echo 1; ?><div></div>');
});

test('one Undo leaves the </ that was typed @cross', async ({ page }) => {
  await typeInto(page, 'a.html', '<div>', '</');
  await expect.poll(() => sourceText(page)).toBe('<div></div>');
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(() => sourceText(page)).toBe('<div></');
  await page.keyboard.type('x');
  await expect.poll(() => sourceText(page)).toBe('<div></x');
});

test('the cursor ends up just after the finished tag', async ({ page }) => {
  await typeInto(page, 'a.html', '<div>', '</x');
  await expect.poll(() => sourceText(page)).toBe('<div></div>x');
});

test('nothing is added on > or anywhere </ is not a closing tag', async ({ page }) => {
  await typeInto(page, 'a.html', '<div>', '<p>');
  await expect.poll(() => sourceText(page)).toBe('<div><p>');
  await typeInto(page, 'a.html', '<div></div>', '</');
  await expect.poll(() => sourceText(page)).toBe('<div></div></');
  await typeInto(page, 'a.html', '<div><!-- ', '</');
  await expect.poll(() => sourceText(page)).toBe('<div><!-- </');
  await typeInto(page, 'a.jsx', 'const x = <b>', '</');
  await expect.poll(() => sourceText(page)).toBe('const x = <b></');
  await open(page, { name: 'a.txt', bytes: '<div>' });
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('</');
  await expect.poll(() => sourceText(page)).toBe('<div></');
  await open(page, { name: 'a.md', bytes: '<div>\n\ntext ' });
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('</');
  await expect.poll(() => sourceText(page)).toBe('<div>\n\ntext </');
});

test('a slash at the very start of a file is just a slash', async ({ page }) => {
  await open(page, { name: 'a.html', bytes: '' });
  await source(page).click();
  await page.keyboard.type('/');
  await expect.poll(() => sourceText(page)).toBe('/');
});

test.describe('the find panel', () => {
  test('has worded labels in the app tones, in light and dark @cross', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await open(page, { name: 'a.txt', bytes: 'alpha beta alpha\n' });
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+F');
    const panel = page.locator('.cm-panel.cm-search');
    await expect(panel.getByRole('button', { name: 'Next' })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Replace all' })).toBeVisible();
    await expect(panel.getByText('Match case')).toBeVisible();
    await expect(panel.getByPlaceholder('Replace with')).toBeVisible();
    const look = () =>
      panel.getByRole('button', { name: 'Next' }).evaluate((button) => {
        const style = getComputedStyle(button);
        return { image: style.backgroundImage, color: style.color, panel: getComputedStyle(button.closest('.cm-panels')!).backgroundColor };
      });
    const dark = await look();
    expect(dark.image).toBe('none');
    expect(dark.color).toBe('rgb(216, 218, 221)');
    await page.emulateMedia({ colorScheme: 'light' });
    const light = await look();
    expect(light.color).toBe('rgb(38, 40, 43)');
    expect(dark.panel).toBe('rgb(41, 44, 48)');
    expect(light.panel).toBe('rgb(240, 240, 238)');
  });

  test.describe('in Catalan', () => {
    test.use({ locale: 'ca-ES' });
    test('is translated', async ({ page }) => {
      await page.goto('/');
      await open(page, { name: 'a.txt', bytes: 'alpha\n' });
      await source(page).click();
      await page.keyboard.press('ControlOrMeta+F');
      const panel = page.locator('.cm-panel.cm-search');
      await expect(panel.getByRole('button', { name: 'Següent' })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Substitueix-les totes' })).toBeVisible();
      await expect(panel.getByText('Distingeix majúscules')).toBeVisible();
    });
  });
});

import { expect, test } from '@playwright/test';
import { cell, downloadSaved, expectClean, expectDirty, open, rendered, runCommand, source, sourceText, settle, useDownloads } from './helpers';

test.beforeEach(async ({ page }) => {
  await useDownloads(page);
  await page.goto('/');
});

const utf16 = (text: string, little: boolean) => {
  const bom = little ? [0xff, 0xfe] : [0xfe, 0xff];
  const body = Buffer.from(text, 'utf16le');
  if (!little) body.swap16();
  return Buffer.concat([Buffer.from(bom), body]);
};
const cp1252 = (text: string) => Buffer.from(text, 'latin1');

const ROUND_TRIPS: Array<[string, string, Buffer]> = [
  ['CRLF markdown', 'a.md', Buffer.from('# Title\r\n\r\ntext\r\n')],
  ['CRLF CSV', 'a.csv', Buffer.from('a;b\r\n1;2\r\n')],
  ['CRLF text', 'a.txt', Buffer.from('one\r\ntwo\r\n')],
  ['CR only', 'cr.txt', Buffer.from('one\rtwo\r')],
  ['no final newline', 'b.md', Buffer.from('# Title\n\ntext')],
  ['no final newline CSV', 'b.csv', Buffer.from('a,b\n1,2')],
  ['mixed line endings', 'mixed.md', Buffer.from('a\r\nb\nc\rd')],
  ['UTF-8 BOM', 'c.md', Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('# Títol\n')])],
  ['UTF-8 BOM CSV', 'c.csv', Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('à;é\n')])],
  ['UTF-16 LE', 'd.md', utf16('# Títol 😀\r\n', true)],
  ['UTF-16 BE', 'e.txt', utf16('Títol 😀\n', false)],
  ['UTF-16 CSV', 'd.csv', utf16('a;b\r\nà;é\r\n', true)],
  ['Windows-1252 CSV', 'f.csv', cp1252('nom;preu\r\nà;1,50\r\né;2\r\n')],
  ['Windows-1252 text', 'f.txt', cp1252('Plaça\r\nl·lí\r\n')],
];

for (const [title, name, bytes] of ROUND_TRIPS) {
  test(`AC1 unedited Save As is byte-identical: ${title} @cross`, async ({ page }) => {
    await open(page, { name, bytes });
    await settle(page);
    await expectClean(page);
    const saved = await downloadSaved(page, true);
    expect(Buffer.compare(saved, bytes)).toBe(0);
  });
}

test('AC2 viewing, selecting and copying on the rendered side changes nothing @cross', async ({ page, browserName }) => {
  const text = '---\ntitle: x\n---\n# Heading\n\n* item __bold__\n\n1. one\n1. two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n';
  await open(page, { name: 'a.md', bytes: text });
  await rendered(page).locator('h1').waitFor();
  await rendered(page).locator('h1').click();
  await page.keyboard.press('ControlOrMeta+A');
  if (browserName === 'chromium') await page.keyboard.press('ControlOrMeta+C');
  await page.keyboard.press('ArrowDown');
  await rendered(page).locator('h1').dblclick();
  await settle(page);
  await expect(page.getByTestId('dialog')).toHaveCount(0);
  await expectClean(page);
  expect(await sourceText(page)).toBe(text);
  expect(Buffer.compare(await downloadSaved(page, true), Buffer.from(text))).toBe(0);
});

test('AC3 a one-word source edit changes only that word @cross', async ({ page }) => {
  const text = '# Doc\r\n\r\n* bullet one\r\n* __bold__ target\r\n\r\n__keep__ this\r\n';
  await open(page, { name: 'a.md', bytes: text });
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+ControlOrMeta+ArrowLeft');
  await page.keyboard.type('changed');
  await settle(page);
  const saved = await downloadSaved(page);
  expect(saved.toString()).toBe(text.replace('target', 'changed'));
});

test('AC4 editing one CSV cell changes only that field @cross', async ({ page }) => {
  const text = 'nom;"preu";data\r\n"Joan";1,50;"007"\r\nMaria;"2,75";x\r\n';
  await open(page, { name: 'a.csv', bytes: text });
  await cell(page, 2, 2).click();
  await page.keyboard.type('y');
  await page.keyboard.press('Enter');
  await expectDirty(page);
  expect((await downloadSaved(page)).toString()).toBe('nom;"preu";data\r\n"Joan";1,50;"007"\r\nMaria;"2,75";y\r\n');
});

test('AC4 editing a quoted field keeps its quotes', async ({ page }) => {
  await open(page, { name: 'a.csv', bytes: 'a;"b"\n"c";d\n' });
  await cell(page, 1, 0).dblclick();
  await page.getByTestId('cell-editor').fill('new');
  await page.keyboard.press('Enter');
  expect((await downloadSaved(page)).toString()).toBe('a;"b"\n"new";d\n');
});

test('AC5 Windows-1252 displays correctly and keeps its bytes outside the edit @cross', async ({ page }) => {
  const bytes = cp1252('à;é;ç\r\nñ;·;x\r\n');
  await open(page, { name: 'a.csv', bytes });
  await expect(page.getByTestId('status-encoding')).toHaveText('Windows-1252');
  await expect(cell(page, 0, 0)).toHaveText('à');
  await expect(cell(page, 0, 2)).toHaveText('ç');
  await expect(cell(page, 1, 1)).toHaveText('·');
  await cell(page, 1, 2).click();
  await page.keyboard.press('Enter');
  await page.getByTestId('cell-editor').fill('ñ');
  await page.keyboard.press('Enter');
  expect(Buffer.compare(await downloadSaved(page), cp1252('à;é;ç\r\nñ;·;ñ\r\n'))).toBe(0);
});

test('AC6 values display and save exactly as they appear @cross', async ({ page }) => {
  const text = 'a;b;c;d\n007;1,50;=SUM(A1);<b>x</b>\n';
  await open(page, { name: 'a.csv', bytes: text });
  await expect(cell(page, 1, 0)).toHaveText('007');
  await expect(cell(page, 1, 1)).toHaveText('1,50');
  await expect(cell(page, 1, 2)).toHaveText('=SUM(A1)');
  await expect(cell(page, 1, 3)).toHaveText('<b>x</b>');
  await cell(page, 0, 0).click();
  await page.keyboard.type('A');
  await page.keyboard.press('Enter');
  expect((await downloadSaved(page)).toString()).toBe(text.replace('a;b', 'A;b'));
});

test('Spanish Excel export works with no configuration', async ({ page }) => {
  await open(page, { name: 'export.csv', bytes: cp1252('Nom;Import\r\nJosé;1.234,50\r\nNúria;7,00\r\n') });
  await expect(page.getByTestId('status-delimiter')).toHaveText('semicolon');
  await expect(page.getByTestId('status-encoding')).toHaveText('Windows-1252');
  await expect(page.getByTestId('status-eol')).toHaveText('CRLF');
  await expect(page.getByTestId('status-counts')).toHaveText('3 rows × 2 columns');
  await expect(cell(page, 1, 1)).toHaveText('1.234,50');
});

test('TXT files open, edit and save, keeping their line endings @cross', async ({ page }) => {
  await open(page, { name: 'NOTES.TXT', bytes: 'first\r\nsecond' });
  await expect(page.getByTestId('status-kind')).toHaveText('Text');
  await expect(rendered(page)).toHaveCount(0);
  await expect(source(page)).toContainText('second');
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type(' line');
  await expectDirty(page);
  expect((await downloadSaved(page)).toString()).toBe('first\r\nsecond line');
  await expectClean(page);
});

test('mixed line endings show a notice, and only a saved edit may convert them', async ({ page }) => {
  await open(page, { name: 'a.txt', bytes: 'a\r\nb\r\nc\n' });
  await expect(page.getByTestId('status-mixed')).toBeVisible();
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('x');
  expect((await downloadSaved(page)).toString()).toBe('xa\r\nb\r\nc\r\n');
});

test('the encoding can be changed by reopening, and a BOM is kept when editing', async ({ page }) => {
  const bytes = Buffer.from('café\n');
  await open(page, { name: 'a.txt', bytes });
  await runCommand(page, 'Reopen with encoding: Windows-1252');
  await expect(page.getByTestId('status-encoding')).toHaveText('Windows-1252');
  await expect(source(page)).toContainText('cafÃ©');
  await expectClean(page);
  expect(Buffer.compare(await downloadSaved(page, true), bytes)).toBe(0);
});

test('editing a UTF-16 file saves as UTF-16 with its BOM', async ({ page }) => {
  await open(page, { name: 'a.txt', bytes: utf16('à\n', true) });
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.type('é');
  expect(Buffer.compare(await downloadSaved(page), utf16('éà\n', true))).toBe(0);
});

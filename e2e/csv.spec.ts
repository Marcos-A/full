import { expect, Locator, Page, test } from '@playwright/test';
import { cell, downloadSaved, expectClean, expectDirty, open, runCommand, settle, source, sourceText, useDownloads } from './helpers';

test.beforeEach(async ({ page }) => {
  await useDownloads(page);
  await page.goto('/');
});

test('malformed: short rows display, missing cells are distinct and are not written', async ({ page }) => {
  const text = 'a;b;c\n1\n1;2;3;4\n';
  await open(page, { name: 'a.csv', bytes: text });
  await expect(cell(page, 1, 2)).toHaveClass(/missing/);
  await expect(page.getByTestId('status-counts')).toHaveText('3 rows × 4 columns');
  await cell(page, 0, 0).click();
  await page.keyboard.type('A');
  await page.keyboard.press('Enter');
  expect((await downloadSaved(page)).toString()).toBe('A;b;c\n1\n1;2;3;4\n');
});

test('malformed: an unterminated quote opens as raw text, unchanged, with a warning @cross', async ({ page }) => {
  const text = 'a,b\n"open,c\nd\n';
  await open(page, { name: 'a.csv', bytes: text });
  await expect(page.getByTestId('notice-error')).toContainText('Malformed CSV near line 2');
  await expect(page.getByTestId('grid')).toHaveCount(0);
  expect(await sourceText(page)).toBe(text);
  await expectClean(page);
  expect((await downloadSaved(page, true)).toString()).toBe(text);
});

test('raw view: edits re-parse the grid and can be undone as one step', async ({ page }) => {
  const text = 'a;b\n"1";2\n';
  await open(page, { name: 'a.csv', bytes: text });
  await runCommand(page, 'View: raw CSV text');
  expect(await sourceText(page)).toBe(text);
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('x;y');
  await expect(page.getByTestId('status-counts')).toHaveText('3 rows × 2 columns');
  await runCommand(page, 'View: table');
  await expect(cell(page, 2, 1)).toHaveText('y');
  await expectDirty(page);
  await page.getByTestId('grid').focus();
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(cell(page, 2, 1)).toHaveCount(0);
  await expectClean(page);
});

test('raw view: returning to the table is refused while the text is malformed', async ({ page }) => {
  await open(page, { name: 'a.csv', bytes: 'a;b\n' });
  await runCommand(page, 'View: raw CSV text');
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('"open');
  await runCommand(page, 'View: table');
  await expect(page.getByTestId('notice-error')).toContainText('still malformed');
  await expect(page.getByTestId('grid')).toHaveCount(0);
});

test('delimiter can be overridden without changing the file', async ({ page }) => {
  const text = 'a,b;c,d\n1,2;3,4\n';
  await open(page, { name: 'a.csv', bytes: text });
  await expect(page.getByTestId('status-delimiter')).toHaveText('semicolon');
  await expect(page.getByTestId('status-counts')).toContainText('2 columns');
  await runCommand(page, 'CSV delimiter: comma');
  await expect(page.getByTestId('status-delimiter')).toHaveText('comma');
  await expect(page.getByTestId('status-counts')).toContainText('3 columns');
  await expectClean(page);
  expect((await downloadSaved(page, true)).toString()).toBe(text);
});

test('header toggle does not change the file', async ({ page }) => {
  await open(page, { name: 'a.csv', bytes: 'a;b\n1;2\n' });
  await expect(page.getByTestId('header-row')).toBeVisible();
  await runCommand(page, 'Toggle first row as header');
  await expect(page.getByTestId('header-row')).toHaveCount(0);
  await expect(cell(page, 0, 0)).toHaveText('a');
  await expectClean(page);
});

test('keyboard: Enter edits, Tab and Enter commit and move, Escape cancels, arrows navigate', async ({ page }) => {
  await open(page, { name: 'a.csv', bytes: 'a;b\nc;d\ne;f\n' });
  await cell(page, 0, 0).click();
  await page.keyboard.press('Enter');
  await page.keyboard.press('End');
  await page.keyboard.type('1');
  await page.keyboard.press('Tab');
  await expect(cell(page, 0, 0)).toHaveText('a1');
  await expect(cell(page, 0, 1)).toHaveClass(/active/);
  await page.keyboard.type('Z');
  await page.keyboard.press('Escape');
  await expect(cell(page, 0, 1)).toHaveText('b');
  await page.keyboard.press('ArrowDown');
  await expect(cell(page, 1, 1)).toHaveClass(/active/);
  await page.keyboard.type('q');
  await page.keyboard.press('ArrowLeft');
  await expect(cell(page, 1, 1)).toHaveText('q');
  await expect(cell(page, 1, 0)).toHaveClass(/active/);
  await page.keyboard.type('w');
  await page.keyboard.press('Enter');
  await expect(cell(page, 1, 0)).toHaveText('w');
  await expect(cell(page, 2, 0)).toHaveClass(/active/);
  await page.keyboard.press('ControlOrMeta+Z');
  await expect(cell(page, 1, 0)).toHaveText('c');
  await page.keyboard.press('ControlOrMeta+Shift+Z');
  await expect(cell(page, 1, 0)).toHaveText('w');
});

test('insert and delete rows and columns through commands, leaving other fields byte-identical', async ({ page }) => {
  const text = '"a";b\r\nc;"d"\r\n';
  await open(page, { name: 'a.csv', bytes: text });
  await cell(page, 1, 0).click();
  await runCommand(page, 'Insert row above');
  await expect(page.getByTestId('status-counts')).toHaveText('3 rows × 2 columns');
  await runCommand(page, 'Insert column right');
  await expect(page.getByTestId('status-counts')).toHaveText('3 rows × 3 columns');
  expect((await downloadSaved(page, true)).toString()).toBe('"a";;b\r\n;;\r\nc;;"d"\r\n');
  await page.getByTestId('grid').focus();
  await cell(page, 0, 1).click();
  await runCommand(page, 'Delete selected columns');
  await cell(page, 1, 0).click();
  await runCommand(page, 'Delete selected rows');
  expect((await downloadSaved(page, true)).toString()).toBe(text);
});

test('columns can be resized, and the page handles a very wide table', async ({ page }) => {
  await open(page, { name: 'a.csv', bytes: 'a;b\n1;2\n' });
  const head = page.locator('.col-head').first();
  const before = (await head.boundingBox())!;
  const handle = (await page.getByTestId('col-resize').first().boundingBox())!;
  await page.mouse.move(handle.x + 3, handle.y + 5);
  await page.mouse.down();
  await page.mouse.move(handle.x + 103, handle.y + 5, { steps: 4 });
  await page.mouse.up();
  expect((await head.boundingBox())!.width).toBeGreaterThan(before.width + 80);
  await expectClean(page);
});

test.describe('row numbers and column letters', () => {
  const FILE = '"a";b;c\r\n1;"2";3\r\n4;5;6\r\n7;8;9';
  const rowHead = (page: Page, n: number) => page.getByTestId('row-head').nth(n);
  const colHead = (page: Page, n: number) => page.getByTestId('col-head').nth(n);
  const menu = (page: Page) => page.getByTestId('head-menu');

  async function dragTo(page: Page, from: Locator, to: Locator, edge: 'top' | 'bottom' | 'left' | 'right') {
    const a = (await from.boundingBox())!;
    const b = (await to.boundingBox())!;
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await page.mouse.down();
    const x = edge === 'left' ? b.x + 2 : edge === 'right' ? b.x + b.width - 2 : b.x + b.width / 2;
    const y = edge === 'top' ? b.y + 2 : edge === 'bottom' ? b.y + b.height - 2 : b.y + b.height / 2;
    await page.mouse.move(x, y, { steps: 6 });
    await expect(page.getByTestId('drop-line')).toBeVisible();
    await page.mouse.up();
    await expect(page.getByTestId('drop-line')).toHaveCount(0);
  }

  test('clicking a row number offers insert and delete', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: FILE });
    await rowHead(page, 2).click();
    await expect(cell(page, 2, 2)).toHaveClass(/in-range/);
    await menu(page).getByRole('menuitem', { name: 'Insert row above' }).click();
    await expect(menu(page)).toHaveCount(0);
    expect((await downloadSaved(page, true)).toString()).toBe('"a";b;c\r\n1;"2";3\r\n;;\r\n4;5;6\r\n7;8;9');
    await rowHead(page, 2).click();
    await menu(page).getByRole('menuitem', { name: 'Delete row' }).click();
    expect((await downloadSaved(page, true)).toString()).toBe(FILE);
    await rowHead(page, 3).click();
    await menu(page).getByRole('menuitem', { name: 'Insert row below' }).click();
    await expect(page.getByTestId('status-counts')).toHaveText('5 rows × 3 columns');
    expect((await downloadSaved(page, true)).toString()).toBe(FILE + '\r\n;;');
  });

  test('clicking a column letter offers insert and delete', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: FILE });
    await colHead(page, 1).click();
    await expect(cell(page, 3, 1)).toHaveClass(/in-range/);
    await menu(page).getByRole('menuitem', { name: 'Insert column right' }).click();
    await expect(page.getByTestId('status-counts')).toHaveText('4 rows × 4 columns');
    expect((await downloadSaved(page, true)).toString()).toBe('"a";b;;c\r\n1;"2";;3\r\n4;5;;6\r\n7;8;;9');
    await colHead(page, 2).click();
    await menu(page).getByRole('menuitem', { name: 'Delete column' }).click();
    expect((await downloadSaved(page, true)).toString()).toBe(FILE);
    await colHead(page, 0).click();
    await menu(page).getByRole('menuitem', { name: 'Insert column left' }).click();
    await expect(cell(page, 1, 1)).toHaveText('1');
  });

  test('Shift+click selects a range, and the menu acts on all of it', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: FILE });
    await rowHead(page, 1).click();
    await rowHead(page, 2).click({ modifiers: ['Shift'] });
    await menu(page).getByRole('menuitem', { name: 'Delete 2 rows' }).click();
    expect((await downloadSaved(page, true)).toString()).toBe('"a";b;c\r\n7;8;9');
  });

  test('the menu closes with Escape, an outside click, or scrolling, and right-click opens it', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: FILE });
    await rowHead(page, 1).click();
    await expect(menu(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveCount(0);
    await colHead(page, 1).click({ button: 'right' });
    await expect(menu(page).getByRole('menuitem', { name: 'Delete column' })).toBeVisible();
    await cell(page, 1, 0).click();
    await expect(menu(page)).toHaveCount(0);
    await expectClean(page);
  });

  test('dragging a row moves it, keeps raw fields and line endings, and undoes as one step', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: FILE });
    await dragTo(page, rowHead(page, 3), rowHead(page, 1), 'top');
    await expect(menu(page)).toHaveCount(0);
    await expect(cell(page, 1, 0)).toHaveText('7');
    await expect(cell(page, 1, 2)).toHaveClass(/in-range/);
    const moved = '"a";b;c\r\n7;8;9\r\n1;"2";3\r\n4;5;6';
    expect((await downloadSaved(page, true)).toString()).toBe(moved);
    await page.getByTestId('grid').focus();
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(cell(page, 1, 0)).toHaveText('1');
    expect((await downloadSaved(page, true)).toString()).toBe(FILE);
  });

  test('a row can be dragged down, and onto the header position', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: FILE });
    await dragTo(page, rowHead(page, 1), rowHead(page, 2), 'bottom');
    expect((await downloadSaved(page, true)).toString()).toBe('"a";b;c\r\n4;5;6\r\n1;"2";3\r\n7;8;9');
    await dragTo(page, rowHead(page, 2), rowHead(page, 0), 'center' as 'top');
    await expect(cell(page, 0, 0)).toHaveText('1');
    await expect(page.getByTestId('header-row')).toContainText('1');
  });

  test('dragging a column moves it with its width, and undoes as one step', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: 'short;' + 'a long heading value here' + ';c\n1;2;3\n' });
    const wideWidth = (await colHead(page, 1).boundingBox())!.width;
    await dragTo(page, colHead(page, 1), colHead(page, 0), 'left');
    await expect(cell(page, 0, 0)).toHaveText('a long heading value here');
    await expect.poll(async () => (await colHead(page, 0).boundingBox())!.width).toBe(wideWidth);
    await expect(cell(page, 1, 0)).toHaveClass(/in-range/);
    expect((await downloadSaved(page, true)).toString()).toBe('a long heading value here;short;c\n2;1;3\n');
    await page.getByTestId('grid').focus();
    await page.keyboard.press('ControlOrMeta+Z');
    await expect(cell(page, 0, 0)).toHaveText('short');
  });

  test('dragging a selected range moves all of it', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: 'a\nb\nc\nd\n' });
    await page.getByTestId('grid').focus();
    await rowHead(page, 0).click();
    await rowHead(page, 1).click({ modifiers: ['Shift'] });
    await page.keyboard.press('Escape');
    await dragTo(page, rowHead(page, 1), rowHead(page, 3), 'bottom');
    expect((await downloadSaved(page, true)).toString()).toBe('c\nd\na\nb\n');
  });

  test('Escape cancels a drag, and a drop in the same place changes nothing', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: FILE });
    const from = (await rowHead(page, 1).boundingBox())!;
    const to = (await rowHead(page, 3).boundingBox())!;
    await page.mouse.move(from.x + 5, from.y + 5);
    await page.mouse.down();
    await page.mouse.move(to.x + 5, to.y + 5, { steps: 4 });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('drop-line')).toHaveCount(0);
    await page.mouse.up();
    await expectClean(page);
    await dragTo(page, rowHead(page, 1), rowHead(page, 1), 'bottom');
    await expectClean(page);
    await expect(menu(page)).toHaveCount(0);
  });

  test('a drag near the edge scrolls a long table', async ({ page }) => {
    const rows = Array.from({ length: 400 }, (_, i) => `r${i};x`).join('\n') + '\n';
    await open(page, { name: 'a.csv', bytes: rows });
    const grid = page.getByTestId('grid');
    const box = (await grid.boundingBox())!;
    const head = (await rowHead(page, 1).boundingBox())!;
    await page.mouse.move(head.x + 5, head.y + 5);
    await page.mouse.down();
    await page.mouse.move(head.x + 5, box.y + box.height - 8, { steps: 5 });
    await expect.poll(() => grid.evaluate((el) => el.scrollTop)).toBeGreaterThan(300);
    await page.mouse.up();
    await expect(page.getByTestId('drop-line')).toHaveCount(0);
    const saved = (await downloadSaved(page, true)).toString().split('\n');
    expect(saved).toHaveLength(401);
    expect(saved.indexOf('r1;x')).toBeGreaterThan(10);
    expect(saved[1]).toBe('r2;x');
  });

  test('moves are also commands, so the keyboard can do them', async ({ page }) => {
    await open(page, { name: 'a.csv', bytes: FILE });
    await cell(page, 2, 0).click();
    await runCommand(page, 'Move selected rows up');
    await expect(cell(page, 1, 0)).toHaveText('4');
    await runCommand(page, 'Move selected rows down');
    await expect(cell(page, 1, 0)).toHaveText('1');
    await cell(page, 1, 0).click();
    await runCommand(page, 'Move selected columns right');
    expect((await downloadSaved(page, true)).toString()).toBe('b;"a";c\r\n"2";1;3\r\n5;4;6\r\n8;7;9');
    await cell(page, 0, 1).click();
    await runCommand(page, 'Move selected columns left');
    await expectDirty(page);
    await cell(page, 0, 0).click();
    await runCommand(page, 'Move selected rows up');
    await expect(cell(page, 0, 0)).toHaveText('a');
  });
});

test('selection: whole rows, whole columns and whole table', async ({ page }) => {
  await open(page, { name: 'a.csv', bytes: 'a;b\nc;d\ne;f\n' });
  await page.locator('.row-head').nth(1).click();
  await expect(cell(page, 1, 0)).toHaveClass(/in-range/);
  await expect(cell(page, 1, 1)).toHaveClass(/in-range/);
  await expect(cell(page, 0, 0)).not.toHaveClass(/in-range/);
  await page.locator('.col-head').nth(1).click();
  await expect(cell(page, 0, 1)).toHaveClass(/in-range/);
  await expect(cell(page, 2, 1)).toHaveClass(/in-range/);
  await expect(cell(page, 2, 0)).not.toHaveClass(/in-range/);
  await page.keyboard.press('ControlOrMeta+A');
  await expect(cell(page, 2, 0)).toHaveClass(/in-range/);
  await cell(page, 0, 0).click();
  await page.keyboard.press('Shift+ArrowDown');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(cell(page, 1, 1)).toHaveClass(/in-range/);
  await expect(cell(page, 2, 0)).not.toHaveClass(/in-range/);
});

test.describe('AC9 clipboard', () => {
  test('multi-cell copy writes tab-separated text and an HTML table', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard read');
    await open(page, { name: 'a.csv', bytes: 'a;b;c\n"1,5";<i>;x\n3;4;y\n' });
    await cell(page, 1, 0).click();
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('ControlOrMeta+C');
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const [item] = await navigator.clipboard.read();
          return {
            plain: await (await item.getType('text/plain')).text(),
            html: await (await item.getType('text/html')).text(),
          };
        }),
      )
      .toMatchObject({
        plain: '1,5\t<i>\r\n3\t4',
        html: expect.stringContaining('<tr><td>1,5</td><td>&lt;i&gt;</td></tr><tr><td>3</td><td>4</td></tr>'),
      });
    await expectClean(page);
  });

  test('copy commands work from the palette', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard read');
    await open(page, { name: 'a.csv', bytes: 'a;b\n1;2\n' });
    await runCommand(page, 'Copy whole table');
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('a\tb\r\n1\t2');
  });

  test('tab-separated paste fills the right cells, grows the table, and undoes as one step', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard write');
    const text = 'a;b\n1;2\n';
    await open(page, { name: 'a.csv', bytes: text });
    await cell(page, 1, 1).click();
    await page.evaluate(() => navigator.clipboard.writeText('x\ty\r\n"p\nq"\tr\r\n'));
    await page.keyboard.press('ControlOrMeta+V');
    await expect(cell(page, 1, 1)).toHaveText('x');
    await expect(cell(page, 1, 2)).toHaveText('y');
    await expect(cell(page, 2, 1)).toHaveText('p ⏎ q');
    await expect(cell(page, 2, 2)).toHaveText('r');
    await expect(cell(page, 0, 2)).toHaveClass(/missing/);
    expect((await downloadSaved(page, true)).toString()).toBe('a;b\n1;x;y\n;"p\nq";r\n');
    await page.getByTestId('grid').focus();
    await page.keyboard.press('ControlOrMeta+Z');
    expect((await downloadSaved(page, true)).toString()).toBe(text);
  });
});

test('Delete clears the selection, as one undo step', async ({ page }) => {
  await open(page, { name: 'a.csv', bytes: 'a;"b"\nc;d\n' });
  await cell(page, 0, 0).click();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Delete');
  expect((await downloadSaved(page)).toString()).toBe(';""\nc;d\n');
  await page.getByTestId('grid').focus();
  await page.keyboard.press('ControlOrMeta+Z');
  await settle(page);
  await expectDirty(page);
  await expect(cell(page, 0, 0)).toHaveText('a');
});

test('fast typing across cells loses nothing', async ({ page }) => {
  const rows = 12;
  await open(page, { name: 'a.csv', bytes: Array.from({ length: rows }, () => ';;').join('\n') + '\n' });
  await cell(page, 0, 0).click();
  // No pauses at all, including right after each Tab and Enter.
  for (let r = 0; r < rows; r++) {
    await page.keyboard.type(`alpha${r}`);
    await page.keyboard.press('Tab');
    await page.keyboard.type(`beta${r}`);
    await page.keyboard.press('Tab');
    await page.keyboard.type(`gamma${r}`);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Home');
  }
  const expected = Array.from({ length: rows }, (_, r) => `alpha${r};beta${r};gamma${r}`).join('\n') + '\n';
  expect((await downloadSaved(page)).toString()).toBe(expected);
});

test('Escape returns focus at once, so typing continues in the grid', async ({ page }) => {
  await open(page, { name: 'a.csv', bytes: 'a;b\n' });
  await cell(page, 0, 0).click();
  await page.keyboard.type('x');
  await page.keyboard.press('Escape');
  await page.keyboard.type('y');
  await page.keyboard.press('Enter');
  await expect(cell(page, 0, 0)).toHaveText('y');
});

// A composition only starts in an editable element, so these fail if a selected cell's focus
// isn't on one. Chromium only: real compositions need CDP. A real dead key still needs a Mac.
test('accents typed with a dead key into a selected cell keep the accent', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'needs CDP');
  await open(page, { name: 'a.csv', bytes: 'a;b\n' });
  await cell(page, 0, 0).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: '`', selectionStart: 1, selectionEnd: 1 });
  await expect(page.getByTestId('grid-input')).toHaveValue('`');
  await cdp.send('Input.insertText', { text: 'à' });
  await expect(page.getByTestId('cell-editor')).toHaveValue('à');
  await page.keyboard.press('Enter');
  await expect(cell(page, 0, 0)).toHaveText('à');
});

test('a composition in a selected cell blocks grid keys until it ends', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'needs CDP');
  await open(page, { name: 'a.csv', bytes: 'a;b\nc;d\n' });
  await cell(page, 0, 0).click();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.imeSetComposition', { text: 'x', selectionStart: 1, selectionEnd: 1 });
  await page.keyboard.press('ArrowDown');
  await cdp.send('Input.insertText', { text: 'é' });
  await page.keyboard.press('Enter');
  await expect(cell(page, 0, 0)).toHaveText('é');
});

test('text inserted without a composition starts editing the selected cell', async ({ page }) => {
  await open(page, { name: 'a.csv', bytes: 'a;b\n' });
  await cell(page, 0, 0).click();
  await page.keyboard.insertText('🙂');
  await expect(page.getByTestId('cell-editor')).toHaveValue('🙂');
  await page.keyboard.press('Enter');
  await expect(cell(page, 0, 0)).toHaveText('🙂');
});

import { Page, test } from '@playwright/test';
import { open, rendered, source } from './helpers';

// Run with `npm run docs:screenshots`. Writes the README's images, using sample data only.
test.use({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });

const MARKDOWN = `---
title: Field notes
status: draft
---
# Field notes

A quiet place to write, with *every* byte kept as __you__ left it.

## This week

- [x] Check the survey results
- [ ] Share the [summary](https://example.test)

| Site | Visits |
|:---|---:|
| Girona | 128 |
| València | 96 |

> Change what you meant to change. Nothing else.
`;

const NAMES = ['Aina', 'Biel', 'Carla', 'Dídac', 'Emma', 'Ferran', 'Gemma', 'Hugo', 'Irene', 'Jan', 'Laia', 'Marc', 'Núria', 'Oriol', 'Paula', 'Quim', 'Rita', 'Sergi', 'Txell', 'Unai'];
const CSV =
  'Name;Town;Score;Date;Notes\r\n' +
  Array.from({ length: 60 }, (_, i) => {
    const score = `${(i * 7) % 10},${(i * 3) % 10}`;
    return `${NAMES[i % NAMES.length]};${['Girona', 'Reus', 'Vic', 'Tortosa'][i % 4]};${score};2026-0${(i % 9) + 1}-1${i % 9};"Checked, on time"`;
  }).join('\r\n') +
  '\r\n';

async function prepare(page: Page, scheme: 'dark' | 'light') {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto('/');
  await page.getByTestId('empty').waitFor();
  // The build label would go out of date with the next commit.
  await page.addStyleTag({ content: '.status-build { visibility: hidden; }' });
}

for (const scheme of ['dark', 'light'] as const) {
  test(`markdown ${scheme}`, async ({ page }) => {
    await prepare(page, scheme);
    await open(page, { name: 'field-notes.md', bytes: MARKDOWN });
    await rendered(page).locator('h1').waitFor();
    await source(page).click();
    await page.keyboard.press('ControlOrMeta+Home');
    await page.waitForTimeout(250);
    await page.screenshot({ path: `docs/screenshots/markdown-${scheme}.png` });
  });

  test(`csv ${scheme}`, async ({ page }) => {
    await prepare(page, scheme);
    await open(page, { name: 'survey.csv', bytes: Buffer.from(CSV, 'latin1') });
    await page.getByTestId('row-head').nth(4).click({ button: 'right' });
    await page.getByTestId('head-menu').waitFor();
    await page.waitForTimeout(250);
    await page.screenshot({ path: `docs/screenshots/csv-${scheme}.png` });
  });
}

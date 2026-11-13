import { expect, Page, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { downloadSaved, open, rendered, runCommand, settle, source, useDownloads } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEBgIApD5fRAAAAABJRU5ErkJggg==', 'base64');

function capture(page: Page) {
  const requests: Array<{ url: string; method: string; body: string | null }> = [];
  page.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() }));
  return requests;
}

test('AC21 a full open, edit and save flow sends no content anywhere @cross', async ({ page, baseURL }) => {
  await useDownloads(page);
  const requests = capture(page);
  await page.goto('/');
  const secret = 'SECRET-CONTENT-7f3a';
  await open(page, { name: 'secret-file.md', bytes: `# ${secret}\n` });
  await source(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.type('more secret typing');
  await settle(page);
  await downloadSaved(page);
  await open(page, { name: 'data.csv', bytes: `a;${secret}\n` });
  await settle(page);

  const origin = new URL(baseURL!).origin;
  for (const request of requests) {
    if (request.url.startsWith('blob:')) continue;
    expect(new URL(request.url).origin, request.url).toBe(origin);
    expect(request.method, request.url).toBe('GET');
    expect(request.url).not.toContain(secret);
    expect(request.url).not.toContain('secret-file');
    expect(request.body).toBeNull();
  }
  expect(requests.length).toBeGreaterThan(0);
});

test('AC21 remote images stay blocked until enabled for that file @cross', async ({ page }) => {
  const external: string[] = [];
  await page.route('https://images.example.test/**', (route) => {
    external.push(route.request().url());
    return route.fulfill({ body: PNG, contentType: 'image/png' });
  });
  await page.goto('/');
  await open(page, { name: 'a.md', bytes: '![pic](https://images.example.test/a.png)\n' });
  const placeholder = rendered(page).locator('.md-image-placeholder');
  await expect(placeholder).toContainText('images.example.test');
  await settle(page);
  expect(external).toEqual([]);
  await expect(rendered(page).locator('img[src]')).toHaveCount(0);

  await runCommand(page, 'Load remote images');
  await expect(rendered(page).locator('img[src]')).toHaveAttribute('src', 'https://images.example.test/a.png');
  await expect.poll(() => external.length).toBeGreaterThan(0);
  await expect(page.getByTestId('dirty')).toHaveCount(0);

  // Another file stays blocked.
  await open(page, { name: 'b.md', bytes: '![pic](https://images.example.test/b.png)\n' });
  await expect(rendered(page).locator('.md-image-placeholder')).toBeVisible();
  await settle(page);
  expect(external.some((u) => u.endsWith('b.png'))).toBe(false);
});

test('the website bundle has no desktop or test-host code', async ({ baseURL }) => {
  test.skip(!baseURL?.includes('localhost'), 'reads the local build');
  const assets = readdirSync('dist/assets').filter((name) => name.endsWith('.js'));
  expect(assets.length).toBeGreaterThan(0);
  for (const name of assets) {
    const code = readFileSync(`dist/assets/${name}`, 'utf8');
    for (const marker of ['@tauri-apps', '__TAURI', 'open_external', '__fake', 'fake-disk', 'on this computer']) {
      expect(code.includes(marker), `${marker} in ${name}`).toBe(false);
    }
  }
});

test('security headers are served', async ({ page }) => {
  const response = await page.goto('/');
  const headers = response!.headers();
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('no-referrer');
});

test('nothing violates the content security policy @cross', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content.Security.Policy/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/');
  await open(page, { name: 'a.md', bytes: '# Hi\n\n| a |\n|---|\n| 1 |\n' });
  await rendered(page).locator('h1').waitFor();
  await open(page, { name: 'b.csv', bytes: 'a;b\n' });
  await settle(page);
  expect(violations).toEqual([]);
});

test('AC21 printing makes no request for remote images until they are enabled @cross', async ({ page }) => {
  const external: string[] = [];
  await page.route('https://images.example.test/**', (route) => {
    external.push(route.request().url());
    return route.fulfill({ body: PNG, contentType: 'image/png' });
  });
  await page.addInitScript(() => {
    window.print = () => undefined;
  });
  await page.goto('/');
  await open(page, { name: 'a.md', bytes: '# Pics\n\n![pic](https://images.example.test/a.png)\n\n![rel](pic.png)\n' });
  await rendered(page).locator('h1').waitFor();
  await runCommand(page, 'Print or save as PDF');
  await expect(page.locator('#print-root .md-image-placeholder')).toHaveCount(2);
  await settle(page);
  expect(external).toEqual([]);
});

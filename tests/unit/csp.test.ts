import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('content security policy', () => {
  it('is the same in the deployed site and in what the tests run under', () => {
    const deployed = /Content-Security-Policy "([^"]+)"/.exec(read('deploy/security-headers.conf'))?.[1];
    const tested = /'Content-Security-Policy':\s*"([^"]+)"/.exec(read('vite.config.ts'))?.[1];
    expect(deployed).toBeTruthy();
    expect(tested).toBe(deployed);
  });
});

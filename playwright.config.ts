import { defineConfig, devices } from '@playwright/test';

const external = process.env.BASE_URL;

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  fullyParallel: true,
  workers: 4,
  reporter: [['list']],
  use: {
    baseURL: external || 'http://localhost:4173',
    trace: 'off',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /performance/,
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
    // Timings need the machine to itself: run with `npm run test:perf`, not alongside the others.
    { name: 'performance', testMatch: /performance/, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testIgnore: /performance/, use: { ...devices['Desktop Firefox'] }, grep: /@cross/ },
    { name: 'webkit', testIgnore: /performance/, use: { ...devices['Desktop Safari'] }, grep: /@cross/ },
  ],
  webServer: external
    ? undefined
    : { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 30_000 },
});

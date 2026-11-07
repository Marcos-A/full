import { defineConfig, devices } from '@playwright/test';

const external = process.env.BASE_URL;
const IGNORED = /performance|capture|native\.spec/;

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
      testIgnore: IGNORED,
      use: { ...devices['Desktop Chrome'], permissions: ['clipboard-read', 'clipboard-write'] },
    },
    // Timings need the machine to itself: run with `npm run test:perf`, not alongside the others.
    { name: 'screenshots', testMatch: /capture/, use: { ...devices['Desktop Chrome'] } },
    { name: 'performance', testMatch: /performance/, use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', testIgnore: IGNORED, use: { ...devices['Desktop Firefox'] }, grep: /@cross/ },
    { name: 'webkit', testIgnore: IGNORED, use: { ...devices['Desktop Safari'] }, grep: /@cross/ },
    // The save flows against a stand-in for the native host, on the engine the Mac app runs on.
    { name: 'native', testMatch: /native\.spec/, use: { ...devices['Desktop Safari'], baseURL: 'http://localhost:4174' } },
  ],
  webServer: external
    ? undefined
    : [
        { command: 'npm run preview', url: 'http://localhost:4173', reuseExistingServer: true, timeout: 30_000 },
        {
          command: 'npx vite preview --mode native-fake --host 0.0.0.0 --port 4174 --strictPort',
          url: 'http://localhost:4174',
          reuseExistingServer: true,
          timeout: 30_000,
        },
      ],
});

import { defineConfig, devices } from '@playwright/test';

/**
 * E2E config for the Avatar frontend.
 *
 * Point BASE_URL at whichever instance you want to exercise:
 *   BASE_URL=http://localhost:8010                 (local Docker container)
 *   BASE_URL=https://avatar-tekstogtal.fly.dev     (production)
 *
 * Tests run serially: several of them post to the LLM and read the resulting
 * conversation back, so parallel workers would race on shared state.
 */
export default defineConfig({
  testDir: './test',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'test/playwright-report', open: 'never' }]],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:8010',
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'off', // the specs take their own, deliberately named
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests of the Widget, on its builds (`dist/`, produced by `yarn test:e2e`).
 * No server: the host page, the scripts and the fake API are served by intercepting
 * requests (`e2e/host.ts`).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './web/tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'pc-1440',
      use: {
        browserName: 'chromium',
        channel: 'chromium',
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: 'pc-1280',
      use: {
        browserName: 'chromium',
        channel: 'chromium',
        viewport: { width: 1280, height: 800 },
      },
    },
    {
      name: 'h5-390',
      use: {
        browserName: 'chromium',
        channel: 'chromium',
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: 'h5-360',
      use: {
        browserName: 'chromium',
        channel: 'chromium',
        hasTouch: true,
        isMobile: true,
        viewport: { width: 360, height: 800 },
      },
    },
  ],
  webServer: [
    {
      command: 'npm --prefix server run dev',
      reuseExistingServer: true,
      timeout: 30_000,
      url: 'http://127.0.0.1:3000/api/health',
    },
    {
      command: 'npm --prefix web run dev -- --host 127.0.0.1',
      reuseExistingServer: true,
      timeout: 30_000,
      url: 'http://127.0.0.1:5173',
    },
  ],
});

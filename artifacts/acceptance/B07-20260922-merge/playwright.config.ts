import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';
import base from '../../../playwright.config';

export default defineConfig({
  ...base,
  testDir: '../../../web/tests/e2e',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5183' },
  webServer: {
    command: 'npm --prefix web run dev -- --host 127.0.0.1 --port 5183 --strictPort',
    cwd: resolve(__dirname, '../../..'),
    reuseExistingServer: false,
    timeout: 30_000,
    url: 'http://127.0.0.1:5183',
  },
});

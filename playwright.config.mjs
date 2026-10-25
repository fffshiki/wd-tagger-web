import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.test.mjs',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4174', headless: true, acceptDownloads: true },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit', use: { browserName: 'webkit' } },
  ],
  webServer: {
    command: 'node scripts/serve.mjs --test',
    env: { PORT: '4174' },
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: false,
  },
});

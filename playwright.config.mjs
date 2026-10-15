import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173/',
    serviceWorkers: 'block',
    acceptDownloads: true,
    viewport: { width: 1100, height: 800 },
  },
  webServer: {
    command: 'node tests/serve.mjs',
    url: 'http://localhost:4173/index.html',
    reuseExistingServer: true,
  },
});

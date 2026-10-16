import { defineConfig } from '@playwright/test';

// PORT lets parallel worktrees run their suites side by side without sharing a server.
const PORT = Number(process.env.PORT || 4173);

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.mjs',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `http://localhost:${PORT}/`,
    serviceWorkers: 'block',
    acceptDownloads: true,
    viewport: { width: 1100, height: 800 },
  },
  webServer: {
    command: 'node tests/serve.mjs',
    url: `http://localhost:${PORT}/index.html`,
    env: { PORT: String(PORT) },
    reuseExistingServer: false,
  },
});

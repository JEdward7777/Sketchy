import { defineConfig, devices } from '@playwright/test';

/**
 * The E2E leg: real browsers against `wrangler dev` (harness/reference/verification.md).
 * Tests open several browser contexts, one per simulated player.
 */
const PORT = 8799;

export default defineConfig({
  testDir: 'test/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices['Pixel 7'],
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    // A fresh client build each run, so the shell under test is the current one.
    command: `npm run build && npx wrangler dev --port ${PORT} --ip 127.0.0.1 --show-interactive-dev-session=false`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { WRANGLER_SEND_METRICS: 'false' },
  },
});

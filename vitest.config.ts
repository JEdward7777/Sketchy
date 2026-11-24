import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * Two of the three verification legs (harness/reference/verification.md).
 *
 * - **unit** runs in node: pure code in src/shared and pure src/client
 *   modules. Fast; fake timers and the seeded RNG helper live here.
 * - **do** runs inside workerd via Miniflare with the real bindings from
 *   wrangler.jsonc: SQLite storage, hibernatable WebSockets and alarms, which
 *   a mock would not reproduce.
 *
 * The third leg, E2E, is Playwright against `wrangler dev` (playwright.config.ts).
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        plugins: [
          cloudflareTest({
            // The real entrypoint, so the Durable Objects under test and the
            // modules the tests import (./clock) are the same instances.
            main: './src/worker/index.ts',
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              // Tests must not depend on a client build existing. The SPA
              // fallback and run_worker_first routing belong to the asset
              // layer in front of the Worker; the E2E leg covers those.
              assets: { directory: './test/do/fixture-assets', binding: 'ASSETS' },
            },
          }),
        ],
        test: {
          name: 'do',
          include: ['test/do/**/*.test.ts'],
        },
      },
    ],
  },
});

import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end journeys against the real stack: Vite on 5173 proxying to the
 * API on 4000, backed by the seeded development database
 * (`pnpm --filter @gatherly/api seed --reset`). Start both dev servers first.
 *
 * Tests run serially because they share one database and build on each
 * other's purchases.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Runs against the production build, so a test can't pass on dev-only behaviour.
  //
  // VITE_API_MODE is forced to `mock` regardless of .env: these tests assert on
  // specific data, so they must not depend on a BFF being up or on whatever
  // happens to be in iTop today. Wiring to the live BFF is verified separately.
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    env: { VITE_API_MODE: 'mock' },
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

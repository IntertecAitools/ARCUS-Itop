import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end against the REAL stack: frontend -> backend -> iTop.
 *
 * No mocks. Playwright starts the backend and a production build of the
 * frontend; iTop itself must already be up (`cd docker && docker compose up -d`),
 * because these tests read and write real tickets through it.
 *
 * Consequence worth knowing: the specs CREATE incidents in iTop and leave them
 * there. That is deliberate — exercising the write path against the real
 * datamodel is the only way to catch what a mock would paper over (iTop
 * deriving priority, rejecting a stimulus, or demanding a field).
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Two workers, not one per core. These run against a real iTop at roughly
  // half a second per REST call; more parallelism just queues up behind it and
  // turns slow responses into spurious timeouts.
  workers: 2,
  reporter: 'list',
  // Measured against this instance, iTop answers a single REST call in 6-8
  // SECONDS, and a page makes several. Playwright's 5s default would fail
  // every assertion on a healthy stack, so these are sized to the real thing
  // rather than to what feels fast.
  expect: { timeout: 45_000 },
  timeout: 240_000,
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  // Only the frontend is started here. The backend is NOT managed by Playwright
  // on purpose: `npm run dev` runs it under `node --watch`, and the watcher
  // keeps the process in a state Playwright's readiness probe does not settle
  // on, which shows up as a 2-minute timeout against a server that is actually
  // healthy. Start it yourself before running the suite:
  //
  //   cd backend && npm run dev          # needs iTop up on :8080
  //
  // `globalSetup` fails fast with that instruction rather than letting every
  // test time out one by one.
  globalSetup: './tests/e2e/global-setup.ts',
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    env: { VITE_API_MODE: 'live' },
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});

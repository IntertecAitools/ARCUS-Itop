import { defineConfig, devices } from '@playwright/test';
import { BFF_URL, FRONTEND_URL, MOCK_URL, TARGET } from './tests/journeys/support/target';

/**
 * Browser tests of the main user journeys, against one of two targets
 * (`E2E_TARGET`, see tests/journeys/support/target.ts):
 *
 * - `mock` (the default, and what CI runs): a production build in
 *   `VITE_API_MODE=mock`, every API call answered by the MSW handlers in
 *   src/mocks. Fast and deterministic; no BFF, no iTop.
 * - `live`: the same specs against a running BFF and the local iTop, plus the
 *   journeys only the real stack can prove (real sign-in, a ticket created and
 *   resolved in iTop, the notification email arriving in Mailpit). Playwright
 *   starts the frontend; the BFF must already be running (globalSetup checks).
 *
 * Specs tagged `@live` run only live, `@mock` only in mock mode; untagged
 * specs run in both.
 */
const live = TARGET === 'live';

export default defineConfig({
  testDir: './tests/journeys',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Live journeys share one iTop and sign in as the same accounts: one at a
  // time. The mock build has no shared state between tabs, so it parallelises.
  workers: live ? 1 : 2,
  fullyParallel: !live,
  grepInvert: live ? /@mock\b/ : /@live\b/,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list'], ['html', { open: 'never', outputFolder: `playwright-report/${TARGET}` }]],
  outputDir: `test-results/${TARGET}`,
  // iTop answers a REST call in about a second on the local instance and a
  // page makes several; the mock answers at once.
  expect: { timeout: live ? 30_000 : 10_000 },
  timeout: live ? 240_000 : 30_000,
  use: {
    baseURL: live ? FRONTEND_URL : MOCK_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  globalSetup: live ? './tests/journeys/support/live-setup.ts' : undefined,
  webServer: live
    ? {
        // The dev server: no build to wait for, and its proxy is not used —
        // VITE_BFF_URL points the app straight at the BFF.
        command: `npx vite --port ${new URL(FRONTEND_URL).port} --strictPort`,
        env: { VITE_API_MODE: 'live', VITE_BFF_URL: BFF_URL },
        url: FRONTEND_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      }
    : {
        // A production build, so CI tests what ships (minus the mode). The BFF
        // URL deliberately points at nothing: a call the mocks do not answer
        // fails loudly instead of reaching someone's running BFF.
        command: `npx vite build --outDir dist-e2e --emptyOutDir && npx vite preview --outDir dist-e2e --port ${new URL(MOCK_URL).port} --strictPort`,
        env: { VITE_API_MODE: 'mock', VITE_BFF_URL: 'http://127.0.0.1:4999/api' },
        url: MOCK_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 360_000,
      },
});

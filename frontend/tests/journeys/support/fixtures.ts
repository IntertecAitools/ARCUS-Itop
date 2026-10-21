import { expect, test as base, type Page } from '@playwright/test';
import { isLive } from './target';

export { expect };

export type Account = { login: string; password: string };

/**
 * Who the journeys sign in as.
 *
 * Mock mode accepts any password, and any login starting with "portal" is the
 * end user (src/mocks/handlers/auth.ts). Live, the staff account defaults to
 * the local iTop's installer admin and the portal account is the one
 * live-setup.ts keeps for these tests; both come through the environment.
 */
export const accounts = {
  staff: (): Account =>
    isLive
      ? { login: process.env.E2E_STAFF_LOGIN ?? 'admin', password: process.env.E2E_STAFF_PASSWORD ?? '' }
      : { login: 'admin', password: 'mock-password' },
  portal: (): Account =>
    isLive
      ? { login: process.env.E2E_PORTAL_LOGIN ?? '', password: process.env.E2E_PORTAL_PASSWORD ?? '' }
      : { login: 'portal', password: 'mock-password' },
};

/** Unique per run, so data a live run creates never collides with an earlier run's. */
export const stamp = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

export async function signIn(page: Page, account: Account) {
  await page.goto('/login');
  await page.getByLabel('Login').fill(account.login);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Signed in once the app moves on from the sign-in page.
  await page.waitForURL((url) => url.pathname !== '/login');
}

/**
 * Every journey starts signed out, from a clean slate.
 *
 * Mock mode: the mock session and data live in sessionStorage (src/mocks/storage.ts),
 * set before the app loads and only once, so later navigations keep what the
 * test did. `seeded` gives the incidents and the dashboard's My Assignments
 * something to show.
 *
 * Both modes: an uncaught page error fails the test, and in mock mode so does
 * any call the mocks did not answer. The mock build points the API at a port
 * nothing listens on, so such a call fails rather than reaching a real BFF.
 */
export const test = base.extend<{ guard: void }>({
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on('pageerror', (e) => problems.push(`page error: ${e.message}`));
      if (!isLive) {
        // Refused, not aborted: a request cancelled by a navigation is not a gap in the mocks.
        page.on('requestfailed', (r) => {
          if (r.url().includes(':4999/') && /REFUSED/.test(r.failure()?.errorText ?? '')) {
            problems.push(`not mocked: ${r.method()} ${r.url()}`);
          }
        });
        await page.addInitScript(() => {
          if (sessionStorage.getItem('arcus.mock.session') === null) {
            sessionStorage.setItem('arcus.mock.session', JSON.stringify('none'));
            sessionStorage.setItem('arcus.mock.seeded', 'true');
          }
        });
      }
      await use();
      expect(problems, 'the page raised errors or made calls the mocks do not answer').toEqual([]);
    },
    { auto: true },
  ],
});

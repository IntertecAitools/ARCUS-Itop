import { accounts, expect, signIn, test } from './support/fixtures';

/**
 * Licence banners (Build Guide, sections 9 and 11), on the mock build. The
 * mock's licence scenario is picked before the app loads.
 */
const useScenario = (scenario: string) => async ({ page }: { page: import('@playwright/test').Page }) => {
  await page.addInitScript((s) => sessionStorage.setItem('arcus.mock.licence', JSON.stringify(s)), scenario);
};

test.describe('non-production licence @mock', () => {
  test.beforeEach(useScenario('nonprod'));

  test('LT-14: the non-production banner is on every page for staff', async ({ page }) => {
    await signIn(page, accounts.staff());
    for (const path of ['/', '/incidents', '/records', '/users']) {
      await page.goto(path);
      await expect(page.locator('[data-kind="nonprod"]')).toContainText('Non-production licence');
    }
  });

  test('LT-14: requesters see it on the portal too', async ({ page }) => {
    await signIn(page, accounts.portal());
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.locator('[data-kind="nonprod"]')).toContainText('Non-production licence');
  });
});

test.describe('licence ended @mock', () => {
  test.beforeEach(useScenario('read_only'));

  test('read-only: every agent sees why changes are paused', async ({ page }) => {
    await signIn(page, accounts.staff());
    await expect(page.getByRole('alert').filter({ hasText: 'The licence has ended' })).toBeVisible();
  });
});

test('a valid licence shows no banner @mock', async ({ page }) => {
  await signIn(page, accounts.staff());
  await expect(page.getByRole('heading').first()).toBeVisible();
  await expect(page.getByTestId('licence-banners')).toHaveCount(0);
});

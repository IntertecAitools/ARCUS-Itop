import { accounts, expect, signIn, test } from './support/fixtures';

/**
 * Licence banners (Build Guide, sections 9 and 11), on the mock build. The
 * mock's licence scenario is picked before the app loads.
 */
const useScenario = (scenario: string) => async ({ page }: { page: import('@playwright/test').Page }) => {
  // Once per tab: a later change (a new key installed) survives reloads.
  await page.addInitScript((s) => {
    if (sessionStorage.getItem('arcus.mock.licence') === null) sessionStorage.setItem('arcus.mock.licence', JSON.stringify(s));
  }, scenario);
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

/** The palette's module entries matching `text`. */
async function paletteHas(page: import('@playwright/test').Page, text: string) {
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search and navigate' });
  await dialog.getByRole('combobox').fill(text);
  const count = await dialog.getByRole('option', { name: new RegExp(text, 'i') }).count();
  await page.keyboard.press('Escape');
  return count > 0;
}

test.describe('Essentials edition @mock', () => {
  test.beforeEach(useScenario('essentials'));

  test('LT-01: only Essentials modules are offered; a Professional screen says so', async ({ page }) => {
    await signIn(page, accounts.staff());
    expect(await paletteHas(page, 'Change calendar')).toBe(false);
    expect(await paletteHas(page, 'Problem trends')).toBe(false);
    expect(await paletteHas(page, 'Incidents')).toBe(true);
    // An old link to a Professional screen: a short page, not an error.
    await page.goto('/change-calendar');
    await expect(page.getByRole('heading', { name: 'Not included in your edition' })).toBeVisible();
    await expect(page.getByText(/part of the Professional edition; your organisation has Essentials/)).toBeVisible();
  });

  test('LT-02: a better key adds the modules, with no reinstall', async ({ page }) => {
    await signIn(page, accounts.staff());
    expect(await paletteHas(page, 'Change calendar')).toBe(false);
    // The Enterprise key is installed: the next status read shows it.
    await page.evaluate(() => sessionStorage.setItem('arcus.mock.licence', JSON.stringify('enterprise')));
    await page.reload();
    expect(await paletteHas(page, 'Change calendar')).toBe(true);
    await page.goto('/change-calendar');
    await expect(page.getByRole('heading', { name: 'Not included in your edition' })).toHaveCount(0);
  });
});

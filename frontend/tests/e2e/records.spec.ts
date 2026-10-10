import { expect, test } from '@playwright/test';

/**
 * The Records module is the generic screen over the whole iTop datamodel: one
 * UI driven by the schema the BFF publishes, rather than a hand-built page per
 * class. That is what makes every class reachable, and it is also why it needs
 * its own coverage — a schema change can break 125 pages at once.
 *
 * Assertions are structural on purpose. These run against a real iTop whose
 * contents change, and most classes are legitimately empty, so pinning row
 * counts would fail for the wrong reason.
 */

test('the index lists classes grouped, and links into them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/records');
  await expect(page.getByRole('heading', { name: 'Records', level: 1 })).toBeVisible();

  // The schema arrived and produced links. 100 is well under the ~125 concrete
  // classes, so this catches a collapsed schema without pinning an exact count.
  const classLinks = page.locator('a[href^="/records/"]');
  await expect(classLinks.first()).toBeVisible();
  expect(await classLinks.count()).toBeGreaterThan(100);

  expect(errors).toEqual([]);
});

test('the filter narrows the class list', async ({ page }) => {
  await page.goto('/records');
  await expect(page.locator('a[href^="/records/"]').first()).toBeVisible();

  await page.getByLabel('Filter classes').fill('zzzznotaclass');
  await expect(page.getByText('No class matches that filter')).toBeVisible();

  await page.getByLabel('Filter classes').fill('Organization');
  await expect(page.locator('a[href="/records/Organization"]')).toBeVisible();
});

test('a populated class lists its rows', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Organization always has rows: the BFF cannot resolve a default org without
  // at least one, so an empty table here would mean the read path is broken.
  await page.goto('/records/Organization');
  await expect(page.getByRole('heading', { name: 'Organization', level: 1 })).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toBeVisible();

  expect(errors).toEqual([]);
});

test('an empty class renders empty rather than erroring', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Nothing has created a change request in this iTop. "Nothing here" and
  // "something broke" must not look the same, which is the point of the check.
  await page.goto('/records/NormalChange');
  await expect(page.getByRole('heading', { name: 'NormalChange', level: 1 })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('a row opens its detail screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/records/Organization');
  await expect(page.getByRole('row').nth(1)).toBeVisible();

  await page.locator('a[href^="/records/Organization/"]').first().click();
  await expect(page).toHaveURL(/\/records\/Organization\/\d+$/);
  // The generic detail screen renders the class's fields from the schema.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  expect(errors).toEqual([]);
});

test('an unknown class does not pretend to exist', async ({ page }) => {
  await page.goto('/records/NoSuchClass');

  // iTop answers 200 for everything, so the BFF has to turn an unknown class
  // into a real error. The UI gives it a whole screen rather than an error
  // banner over an empty table, so the distinction from "no rows" is obvious.
  await expect(page.getByRole('heading', { name: 'Unknown class', level: 1 })).toBeVisible();
  await expect(page.getByText('iTop has no class called "NoSuchClass"')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to records' })).toBeVisible();
});

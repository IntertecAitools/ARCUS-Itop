import { expect, test } from '@playwright/test';

/**
 * Smoke tests for the app shell.
 *
 * These guard the contract the module registry promises: every registered
 * module routes, the chrome survives navigation, and the keyboard paths work.
 * They should keep passing as modules land one by one.
 */

test('dashboard renders every card against an empty dataset', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })).toBeVisible();

  // KPI tiles still render, showing a real zero rather than a blank.
  const totalTile = page.getByText('Total Incidents').locator('xpath=../..');
  await expect(totalTile.getByText('0', { exact: true })).toBeVisible();
  await expect(page.getByText('SLA Compliance')).toBeVisible();

  // With no history there is no delta — "0%" would read as "unchanged" when
  // the truth is "nothing to compare against".
  await expect(page.getByText('vs last week')).toHaveCount(0);

  // Charts degrade to empty states instead of drawing an empty ring or axis.
  await expect(page.getByRole('heading', { name: 'Incident Trend' })).toBeVisible();
  await expect(page.getByText('No activity in this period')).toBeVisible();
  await expect(page.getByText('No incidents yet')).toBeVisible();
  await expect(page.getByText('Nothing under SLA yet')).toBeVisible();

  // Tables use their own empty copy.
  await expect(page.getByText('No incidents in this window')).toBeVisible();
  await expect(page.getByText('Nothing assigned to you')).toBeVisible();

  expect(errors).toEqual([]);
});

test('the sidebar shows no count badges when nothing is outstanding', async ({ page }) => {
  await page.goto('/dashboard');

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  // A zero badge is noise — the absence of a badge is the signal.
  await expect(nav.getByText(/^0$/)).toHaveCount(0);
});

test('an unbuilt module has no nav entry and no route', async ({ page }) => {
  await page.goto('/dashboard');

  // Only built modules appear anywhere in the shell.
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link')).toHaveCount(1);
  await expect(nav.getByRole('link', { name: /Dashboard/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Incidents|Problems|CMDB/ })).toHaveCount(0);

  // And its path is genuinely absent rather than showing an apology screen.
  await page.goto('/problems');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('the dashboard hides cross-links to modules that do not exist', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: 'Incidents by Category' })).toBeVisible();
  // "View all →" would dead-end today, so it isn't offered at all.
  await expect(page.getByRole('link', { name: /View all/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /View details/ })).toHaveCount(0);
});

test('an unknown path falls through to Not found', async ({ page }) => {
  await page.goto('/this-module-does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('the sidebar collapses and the choice survives a reload', async ({ page }) => {
  await page.goto('/dashboard');

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link', { name: /Dashboard/ })).toBeVisible();

  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Expand sidebar' })).toBeVisible();
});

test('Ctrl-K opens the palette and navigates to a module', async ({ page }) => {
  await page.goto('/dashboard');
  // `goto` resolves on `load`, but the shell mounts after the mock worker
  // starts — pressing the shortcut before then hits a page with no listener.
  await expect(page.getByRole('button', { name: 'Collapse sidebar' })).toBeVisible();

  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Search and navigate' });
  await expect(dialog).toBeVisible();

  // The palette lists built modules only — it never surfaces a screen that
  // doesn't exist.
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await expect(dialog.getByRole('option', { name: /Dashboard/ })).toBeVisible();

  await dialog.getByPlaceholder(/jump to a module/i).fill('incidents');
  await expect(dialog.getByText(/No module matches/i)).toBeVisible();
});

test('the theme toggle flips the document theme', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /switch to dark theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

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
  await expect(nav.getByRole('link')).toHaveCount(2);
  await expect(nav.getByRole('link', { name: /Dashboard/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Incidents/ })).toBeVisible();
  await expect(nav.getByRole('link', { name: /Problems|CMDB|Knowledge/ })).toHaveCount(0);

  // And its path is genuinely absent rather than showing an apology screen.
  await page.goto('/problems');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('dashboard cross-links follow the module registry', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Incidents by Category' })).toBeVisible();

  // Incidents is built, so its "View all" links appeared on their own — no
  // edit to the dashboard was needed when the module landed.
  const viewAll = page.getByRole('link', { name: /View all/ });
  await expect(viewAll.first()).toBeVisible();
  for (const link of await viewAll.all()) {
    await expect(link).toHaveAttribute('href', /^\/incidents/);
  }

  // Everything still unbuilt is simply not offered, so no card can dead-end.
  for (const path of ['/sla', '/changes', '/knowledge', '/service-catalog']) {
    await expect(page.locator(`a[href^="${path}"]`)).toHaveCount(0);
  }
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
  await expect(dialog.getByRole('option')).toHaveCount(2);
  await expect(dialog.getByRole('option', { name: /Dashboard/ })).toBeVisible();

  // A built module is reachable from the palette...
  await dialog.getByPlaceholder(/jump to a module/i).fill('incidents');
  await expect(dialog.getByRole('option', { name: /Incidents/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/incidents$/);
  await expect(page.getByRole('heading', { name: 'Incidents', level: 1 })).toBeVisible();

  // ...and one that does not exist is simply not there.
  await page.keyboard.press('Control+k');
  await dialog.getByPlaceholder(/jump to a module/i).fill('problems');
  await expect(dialog.getByText(/No module matches/i)).toBeVisible();
});

test('the theme toggle flips the document theme', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /switch to dark theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

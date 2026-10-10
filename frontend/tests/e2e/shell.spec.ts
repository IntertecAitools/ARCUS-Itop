import { expect, test } from '@playwright/test';

/**
 * Smoke tests for the app shell.
 *
 * These guard the contract the module registry promises: every registered
 * module routes, the chrome survives navigation, and the keyboard paths work.
 * They should keep passing as modules land one by one.
 */

test('dashboard renders every card against live data', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/dashboard');

  await expect(page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })).toBeVisible();

  // Every card is present. The assertions are deliberately about STRUCTURE,
  // not values: these run against a real iTop whose contents change, so
  // pinning a number here would make the suite fail for the wrong reason.
  for (const heading of [
    'Incident Trend',
    'Incidents by Category',
    'SLA Performance',
    'Recent Incidents',
    'My Assignments',
    'Service Requests',
    'Change Calendar',
    'Knowledge Articles',
  ]) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }

  // KPI tiles show a real figure rather than a blank, whatever that figure is.
  const totalTile = page.getByText('Total Incidents').locator('xpath=../..');
  await expect(totalTile.getByText(/^\d+$/)).toBeVisible();
  await expect(page.getByText('SLA Compliance')).toBeVisible();

  expect(errors).toEqual([]);
});

test('the sidebar never renders a zero badge', async ({ page }) => {
  await page.goto('/dashboard');

  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  // A zero badge is noise — the absence of a badge is the signal. This holds
  // whatever the real counts are, so it survives running against live iTop.
  await expect(nav.getByText(/^0$/)).toHaveCount(0);
});

test('the sidebar offers Dashboard and nothing else of ours', async ({ page }) => {
  await page.goto('/dashboard');

  // Incidents, Records and Modules are registered but hidden: they are reached
  // through iTop's tree, the dashboard's cross-links and the palette, so a nav
  // item of their own would only be a second door to the same screens.
  const built = page.getByRole('group', { name: 'Built modules' });
  await expect(built.getByRole('link')).toHaveCount(1);
  await expect(built.getByRole('link', { name: /Dashboard/ })).toBeVisible();
  for (const name of [/Incidents/, /Records/, /Modules/]) {
    await expect(built.getByRole('link', { name })).toHaveCount(0);
  }

  // A path we never registered is genuinely absent rather than showing an
  // apology screen. Problem data is reachable, but at /records/Problem.
  await page.goto('/problems');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('hidden modules still route', async ({ page }) => {
  // The risk in hiding rather than deleting is doing it by deleting. Each of
  // these is reached from somewhere in the UI, so all three must still load.
  for (const [path, heading] of [
    ['/incidents', 'Incidents'],
    ['/records', 'Records'],
    ['/modules', 'Modules'],
    ['/records/Problem', 'Problem'],
  ] as const) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
  }
});

test("iTop's modules arrive through the BFF, not a hardcoded list", async ({ page }) => {
  await page.goto('/dashboard');

  // These groups exist because iTop declares them and the BFF publishes them.
  // Nothing in the frontend names them, so this failing means the navigation
  // stopped flowing rather than that a list needs editing.
  const itop = page.getByRole('group', { name: 'iTop modules' });
  for (const group of [
    'Incident Management',
    'Problem management',
    'Change management',
    'Service management',
    'Helpdesk',
    'Configuration management',
  ]) {
    await expect(itop.getByRole('button', { name: group })).toBeVisible();
  }
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

  // The palette lists our modules AND iTop's entries, so it is now the flat
  // view of everything — which is what makes the sidebar able to stop
  // listing Incidents and Records.
  await expect(dialog.getByRole('option', { name: /Dashboard/ })).toBeVisible();
  expect(await dialog.getByRole('option').count()).toBeGreaterThan(20);

  // An iTop entry is reachable from the palette, by its iTop label...
  await dialog.getByPlaceholder(/jump to a module/i).fill('new problem');
  await expect(dialog.getByRole('option', { name: /New problem/ })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/records\/Problem\/new$/);
  await expect(page.getByRole('heading', { name: 'New Problem', level: 1 })).toBeVisible();

  // ...and something that exists nowhere is simply not offered.
  await page.keyboard.press('Control+k');
  await dialog.getByPlaceholder(/jump to a module/i).fill('zzzznothing');
  await expect(dialog.getByText(/No module matches/i)).toBeVisible();
});

test('the theme toggle flips the document theme', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: /switch to dark theme/i }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

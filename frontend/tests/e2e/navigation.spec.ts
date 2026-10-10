import { expect, test } from '@playwright/test';

/**
 * The navigation is a projection of iTop's own menu tree, served by the BFF.
 *
 * What these guard is the flow, not a list: nothing in the frontend names
 * iTop's groups or views, so if these fail it means the tree stopped arriving
 * rather than that a hardcoded list needs updating.
 */

test('the modules page accounts for every group iTop has', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/modules');
  // Scoped to the content: the sidebar renders the same group names, so an
  // unscoped match would pass without the page rendering anything.
  const content = page.getByRole('main');
  await expect(page.getByRole('heading', { name: 'Modules', level: 1 })).toBeVisible();

  // The real ITSM processes, each a group iTop declares.
  for (const group of [
    'Incident Management',
    'Problem management',
    'Change management',
    'Service management',
    'Helpdesk',
  ]) {
    await expect(content.getByText(group, { exact: true })).toBeVisible();
  }

  // Admin groups are rendered but marked, so "our product" and "iTop's console"
  // stay distinguishable.
  await expect(content.getByText('admin', { exact: true }).first()).toBeVisible();

  expect(errors).toEqual([]);
});

test('it states what iTop has that is not replicated', async ({ page }) => {
  await page.goto('/modules');
  const content = page.getByRole('main');

  // The claim "we replicated iTop" is only honest with the gaps written down.
  await expect(content.getByText('What iTop has that this does not')).toBeVisible();
  await expect(content.getByText('iTop dashboards')).toBeVisible();
  await expect(content.getByText('Waiting on sign-in')).toBeVisible();
});

test('the filter narrows the module list', async ({ page }) => {
  await page.goto('/modules');
  // The sidebar lists the same group names, so the filter can only be observed
  // inside the content region.
  const content = page.getByRole('main');
  await expect(content.getByText('Incident Management', { exact: true })).toBeVisible();

  await page.getByLabel('Filter modules').fill('problem');
  await expect(content.getByText('Problem management', { exact: true })).toBeVisible();
  await expect(content.getByText('Service management', { exact: true })).toHaveCount(0);

  await page.getByLabel('Filter modules').fill('zzzznothing');
  await expect(content.getByText('No module matches that filter')).toBeVisible();
});

test('a filtered view says it is filtered, and can be cleared', async ({ page }) => {
  // "Open incidents" is iTop's own menu. The OQL behind it never reaches the
  // browser — the URL carries the view id and the BFF resolves it.
  await page.goto('/records/Incident?view=Incident:OpenIncidents');

  await expect(page.getByRole('heading', { name: 'Incident', level: 1 })).toBeVisible();
  await expect(page.getByText(/filtered by iTop’s “Open” view/)).toBeVisible();

  await page.getByRole('link', { name: 'Clear filter' }).click();
  await expect(page).toHaveURL(/\/records\/Incident$/);
  await expect(page.getByText(/filtered by/)).toHaveCount(0);
});

test('an unknown view fails loudly rather than showing everything', async ({ page }) => {
  // Silently dropping the filter would show every row where a subset was
  // asked for, which is the dangerous failure here.
  await page.goto('/records/Incident?view=NoSuchView');

  await expect(page.getByRole('alert')).toBeVisible();
});

test('navigating from the sidebar reaches a generic screen', async ({ page }) => {
  await page.goto('/dashboard');

  const itop = page.getByRole('group', { name: 'iTop modules' });
  await itop.getByRole('button', { name: 'Problem management' }).click();

  // Entry labels come from iTop's dictionary, not from our source.
  await itop.getByRole('link', { name: 'All open problems' }).click();
  await expect(page).toHaveURL(/\/records\/Problem\?view=/);
  await expect(page.getByRole('heading', { name: 'Problem', level: 1 })).toBeVisible();
});

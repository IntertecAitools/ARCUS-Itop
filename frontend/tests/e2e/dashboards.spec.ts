import { expect, test } from '@playwright/test';

/**
 * iTop's Overview dashboards, rendered natively through the BFF.
 *
 * The dashlet OQL stays server-side; the frontend only asks for a dashlet by
 * id. These run against real iTop, so they assert structure (the panels iTop
 * declares appear) rather than pinned numbers.
 */

test('an Overview dashboard renders iTop\'s panels', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('/api')) errors.push(`HTTP ${r.status()}`);
  });

  await page.goto('/dashboards/Incident:Overview');
  await expect(page.getByRole('heading', { name: 'Dashboard for Incident Management', level: 1 }))
    .toBeVisible({ timeout: 60000 });

  // iTop's five Incident-overview panels, by their own titles.
  for (const title of [
    'Last 14 days incident per priority',
    'Last 14 days number of incidents',
    'Open incidents by status',
    'Open incidents by agent',
    'Open incidents by customer',
  ]) {
    await expect(page.getByText(title)).toBeVisible();
  }

  expect(errors).toEqual([]);
});

test('a dashboard is reachable from the sidebar as "Overview"', async ({ page }) => {
  await page.goto('/dashboard');
  const modules = page.getByRole('group', { name: 'Modules' });
  await modules.getByRole('button', { name: 'Incident Management' }).click();

  // iTop puts the Overview first in each module group.
  await modules.getByRole('link', { name: 'Overview' }).first().click();
  await expect(page).toHaveURL(/\/dashboards\//);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
});

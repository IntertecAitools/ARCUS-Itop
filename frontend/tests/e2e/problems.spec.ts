import type { Page } from '@playwright/test';
import { accounts, expect, pickLookup, signIn, test } from '../fixtures/app';

async function createProblem(page: Page, title: string) {
  await page.goto('/problems/new');
  await pickLookup(page, /Organization/, 'Demo', 'Demo Corp');
  await page.getByLabel(/^Title/).fill(title);
  await page.getByRole('textbox', { name: /Description/ }).click();
  await page.keyboard.type('Users lose the VPN tunnel every evening.');
  await page.getByLabel(/^Impact/).selectOption('2');
  await page.getByLabel(/^Urgency/).selectOption('1');
  await page.getByRole('button', { name: 'Create problem' }).click();
  await expect(page).toHaveURL(/\/problems\/\d+$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

const lifecycleActions = (page: Page) => page.getByRole('group', { name: 'Lifecycle actions' });

test.describe('Problem Management', () => {
  test('create → assign → resolve → close', async ({ signedIn: page }) => {
    await createProblem(page, 'E2E: VPN drops every evening');
    // iTop computes impact 2 × urgency 1 → Critical
    await expect(page.getByText('Critical').first()).toBeVisible();

    await lifecycleActions(page).getByRole('button', { name: 'Assign' }).click();
    const assign = page.getByRole('dialog');
    await pickLookup(assign, /Team/, 'Network', 'Network Operations');
    await pickLookup(assign, /Agent/, 'Mei', /Mei Lin/);
    await assign.getByLabel('Note').fill('Taking ownership');
    await assign.getByRole('button', { name: 'Assign' }).click();
    await expect(assign).toBeHidden();
    await expect(lifecycleActions(page).getByRole('button', { name: 'Resolve' })).toBeVisible();

    await lifecycleActions(page).getByRole('button', { name: 'Resolve' }).click();
    const resolve = page.getByRole('dialog');
    // Only the fields of ev_resolve are shown
    await expect(resolve.getByRole('combobox', { name: /Team/ })).toHaveCount(0);
    await pickLookup(resolve, /^Service \(required\)/, 'Network', 'Network Connectivity');
    await pickLookup(resolve, 'Service subcategory', 'VPN', 'VPN');
    await resolve.getByRole('button', { name: 'Resolve' }).click();
    await expect(resolve).toBeHidden();

    await lifecycleActions(page).getByRole('button', { name: 'Close' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(lifecycleActions(page)).toHaveCount(0);
    await expect(page.locator('[aria-current="step"]')).toContainText('Closed');

    // the note from the transition is in the case log
    await page.getByRole('tab', { name: /^Activity/ }).click();
    await expect(page.getByText('Taking ownership').first()).toBeVisible();
  });

  test('link an incident', async ({ signedIn: page }) => {
    await createProblem(page, 'E2E: printers stuck');
    await page.getByRole('tab', { name: /^Incidents/ }).click();
    await expect(page).toHaveURL(/tab=incidents/);
    await pickLookup(page, 'Link an incident', 'Print', /Print job stuck/);
    await page.getByRole('button', { name: 'Link', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Related incidents' }).getByText('Print job stuck')).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Incidents/ })).toContainText('1');
  });

  test('add a known error from a problem', async ({ signedIn: page }) => {
    await createProblem(page, 'E2E: ERP batch timeout');
    await page.getByRole('tab', { name: /^Known Errors/ }).click();
    await page.getByRole('button', { name: 'New known error' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel(/^Name/)).toHaveValue('E2E: ERP batch timeout');
    await dialog.getByLabel(/^Symptom/).fill('Close batch runs longer than 30 minutes.');
    await dialog.getByLabel(/^Workaround/).fill('Run with 8 workers.');
    await dialog.getByRole('button', { name: 'Create known error' }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole('table', { name: 'Known errors' }).getByRole('link', { name: 'E2E: ERP batch timeout' }).click();
    await expect(page).toHaveURL(/\/knowledge-base\/known-errors\/\d+$/);
    await expect(page.getByText('Run with 8 workers.')).toBeVisible();
  });

  test('filters live in the URL', async ({ signedIn: page }) => {
    await page.goto('/problems/list?tab=closed&q=VPN');
    await expect(page.getByRole('tab', { name: 'Closed' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Search problems')).toHaveValue('VPN');
    const statuses = page.getByRole('table', { name: 'Problems' }).locator('tbody tr td:nth-child(6)');
    await expect(statuses.first()).toContainText('Closed');

    await page.getByRole('tab', { name: 'All' }).click();
    const filters = page.getByRole('group', { name: 'Problem filters' });
    await filters.getByRole('button', { name: 'Priority' }).click();
    await filters.getByLabel('Critical').check();
    await expect(page).toHaveURL(/priority=1/);
    await expect(page).not.toHaveURL(/tab=/);

    // reload keeps the same view
    await page.reload();
    await expect(page.getByRole('group', { name: 'Problem filters' }).getByRole('button', { name: /Priority \(1\)/ })).toBeVisible();
  });

  test('read-only profile sees no write actions', async ({ page }) => {
    await signIn(page, accounts.agent);
    await expect(page.getByRole('button', { name: /Create/ })).toHaveCount(0);
    await page.goto('/problems/list?tab=open');
    await page.getByRole('table', { name: 'Problems' }).getByRole('link').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(lifecycleActions(page)).toHaveCount(0);
    await page.goto('/problems/new');
    await expect(page.getByText("You don't have access to this page")).toBeVisible();
  });
});

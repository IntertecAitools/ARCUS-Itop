import { accounts, expect, signIn, test } from './support/fixtures';
import { isLive } from './support/target';

/**
 * Any iTop class, through the generic record screens: pick a class, narrow
 * the list with advanced search, open a record.
 *
 * Live, the search is for the organisation iTop's installer creates, which
 * every instance has; the journey only reads.
 */
const wanted = isLive
  ? { term: 'My Company', name: 'My Company/Department' }
  : { term: 'Northwind', name: 'Northwind Traders' };

test('records → advanced search → open a record', async ({ page }) => {
  await signIn(page, accounts.staff());
  await page.goto('/records');

  await page.getByLabel('Filter classes').fill('Organization');
  await page.getByRole('link', { name: 'Organization', exact: true }).click();
  await expect(page).toHaveURL(/\/records\/Organization$/);
  await expect(page.getByRole('heading', { name: 'Organization', level: 1 })).toBeVisible();

  // Rows, by their selection checkbox: other cells link to related records.
  const rows = page.getByRole('row').filter({ has: page.getByRole('checkbox', { name: /^Select #\d+$/ }) });
  await expect(rows.first()).toBeVisible();

  await page.getByRole('button', { name: /Advanced search/ }).click();
  await page.getByRole('button', { name: 'Add condition' }).click();
  await page.getByLabel('Field', { exact: true }).selectOption({ label: 'Name' });
  await page.getByLabel('Condition', { exact: true }).selectOption('contains');
  await page.getByLabel('Value', { exact: true }).fill(wanted.term);
  await page.getByRole('button', { name: 'Apply' }).click();

  // The conditions travel in the URL, so the search can be bookmarked.
  await expect(page).toHaveURL(/criteria=/);
  await expect(page.getByRole('button', { name: 'Advanced search (1)' })).toBeVisible();
  await expect(rows).toHaveCount(1);

  await rows.first().getByRole('link', { name: /^#\d+$/ }).first().click();
  await expect(page).toHaveURL(/\/records\/Organization\/\d+$/);
  await expect(page.getByRole('heading', { name: wanted.name, level: 1 })).toBeVisible();
});

import { accounts, expect, signIn, test } from './support/fixtures';
import { isLive } from './support/target';

/**
 * Choosing another record on a form: type a few letters, pick a suggestion.
 * Long lists (over a thousand customer organizations) are reachable only this way.
 * Mock only: it relies on the mock API's people.
 */
test('a record field suggests what matches as you type', async ({ page }) => {
  test.skip(isLive, 'Relies on the mock API\'s people.');

  await signIn(page, accounts.staff());
  await page.goto('/records/UserRequest/new');

  const caller = page.getByRole('combobox', { name: 'Caller' });
  await caller.click();
  await expect(page.getByRole('option', { name: 'Pia Portal' })).toBeVisible();

  await caller.fill('rav');
  const match = page.getByRole('option', { name: 'Ravi Kumar' });
  await expect(match).toBeVisible();
  await expect(page.getByRole('option', { name: 'Pia Portal' })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('suggestions.png') });

  await match.click();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(caller).toHaveValue('Ravi Kumar');

  await caller.fill('nobody-by-this-name');
  await expect(page.getByText('No matches.')).toBeVisible();
  await caller.blur();
  await expect(caller).toHaveValue('Ravi Kumar');
});

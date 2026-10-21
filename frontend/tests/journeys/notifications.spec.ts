import { accounts, expect, signIn, stamp, test } from './support/fixtures';

/**
 * An administrator sets up "when a request is closed, email the caller".
 * Live, live.spec.ts creates such a rule and proves the email is sent.
 */
test('notification rules list → create a rule', { tag: '@mock' }, async ({ page }) => {
  await signIn(page, accounts.staff());
  await page.goto('/notifications');
  await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
  await expect(page.getByText('Request resolved: tell the caller')).toBeVisible();

  await page.getByRole('link', { name: 'New rule' }).click();
  await expect(page.getByRole('heading', { name: 'New notification rule', level: 1 })).toBeVisible();

  const name = `Request closed ${stamp()}`;
  await page.locator('#rule-name').fill(name);
  await page.locator('#state').selectOption({ label: 'Closed' });
  await page.getByLabel('Subject').fill('Your request {{ref}} is closed');
  await page.locator('#body').fill('Hello {{caller}},\n\n{{ref}} is closed.\n\n{{link}}');
  await page.getByLabel('On: send to the recipients').check();
  await page.getByRole('button', { name: /^(Create|Save)/ }).click();

  // Saved: the editor reopens on the new rule, and it is in the list.
  await expect(page).toHaveURL(/\/notifications\/\d+$/);
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'All rules' }).click();
  await expect(page).toHaveURL(/\/notifications$/);
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(1);
});

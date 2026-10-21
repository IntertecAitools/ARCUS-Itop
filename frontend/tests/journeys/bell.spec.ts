import { accounts, expect, signIn, test } from './support/fixtures';

/**
 * The bell: an unread count on the badge, the list, and reading an item.
 * Live, live.spec.ts checks a real notification reaches the end user's bell.
 */
test('the bell: unread count, open, mark read', { tag: '@mock' }, async ({ page }) => {
  await signIn(page, accounts.staff());

  const unread = page.getByRole('button', { name: 'Notifications, 1 unread' });
  await expect(unread).toBeVisible();
  await unread.click();

  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByText('1 unread')).toBeVisible();
  await expect(panel.getByText('Ticket has been assigned to you')).toBeVisible();

  // Opening an item marks it read and goes to the record it is about.
  await panel.getByRole('button', { name: /INC-1042/ }).click();
  await expect(page).toHaveURL(/\/incidents\/1042$/);
  const bell = page.getByRole('button', { name: 'Notifications', exact: true });
  await expect(bell).toBeVisible();

  // Nothing unread is left, so the panel offers no "Mark all read".
  await bell.click();
  await expect(panel.getByRole('button', { name: /INC-1042/ })).toBeVisible();
  await expect(panel.getByText(/unread/)).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Mark all read' })).toHaveCount(0);
});

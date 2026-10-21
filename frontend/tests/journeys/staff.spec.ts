import { accounts, expect, signIn, test } from './support/fixtures';

/**
 * A staff member's day: sign in, see what is assigned to them, open it and
 * move it on. Live, the lifecycle runs in live.spec.ts on a ticket the run
 * created, since what is assigned to the live admin is not ours to change.
 */

test('signing in returns to the page asked for, then the dashboard', async ({ page }) => {
  await page.goto('/records');
  // Not signed in: sent to sign-in, remembering where they were heading.
  await expect(page).toHaveURL(/\/login\?next=%2Frecords$/);
  await page.getByLabel('Login').fill(accounts.staff().login);
  await page.getByLabel('Password').fill(accounts.staff().password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Records', level: 1 })).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: /good (morning|afternoon|evening)/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My Assignments' })).toBeVisible();
});

test('My Assignments → open an incident → resolve it', { tag: '@mock' }, async ({ page }) => {
  await signIn(page, accounts.staff());

  const row = page.getByRole('row').filter({ hasText: 'VPN connection unavailable' });
  await row.getByRole('link', { name: 'I-001042' }).click();
  await expect(page).toHaveURL(/\/incidents\/1042$/);
  await expect(page.getByRole('heading', { name: 'VPN connection unavailable', level: 1 })).toBeVisible();

  await page.getByRole('button', { name: 'Resolve' }).click();
  const confirm = page.getByRole('button', { name: /Confirm resolve/i });
  // A resolution is required before the action can be sent.
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Resolution', { exact: true }).fill('Restarted the VPN gateway.');
  await confirm.click();

  // Resolved: the next actions are close and reopen, and that survives a reload.
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
});

import { expect, test } from './support/fixtures';

/**
 * Forgot password, from the sign-in page. The answer never says whether the
 * account exists. Live, live.spec.ts also checks a real reset email arrives.
 */
test('forgot password: reachable from sign-in, confirms without saying who exists', async ({ page }) => {
  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await expect(page).toHaveURL(/\/forgot-password$/);

  // An address nobody has: live, nothing is sent, and the answer is the same.
  await page.getByLabel('Login or email').fill(`nobody-${Date.now()}@example.test`);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/If an account matches/)).toBeVisible();

  await page.getByRole('link', { name: 'Back to sign in' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

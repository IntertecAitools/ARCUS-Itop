import { expect, test } from './support/fixtures';

/**
 * The authenticator step of sign-in, in mock mode (src/mocks/handlers/auth.ts:
 * logins starting "mfa" verify, "enrol" set one up; the code is 123456).
 * Against the real BFF and a local identity provider, backend/scripts/e2e-sso.mjs
 * covers the same flows end to end.
 */
test('mfa: an enrolled account gives a code; a wrong one is refused @mock', async ({ page }) => {
  await page.goto('/login?next=%2Frecords');
  await page.getByLabel('Login').fill('mfa.agent');
  await page.getByLabel('Password').fill('mock-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('form', { name: /Verify it.s you/ })).toBeVisible();
  await page.getByLabel('Code').fill('000000');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page.getByRole('alert')).toContainText('That code is not right');

  await page.getByLabel('Code').fill('123456');
  await page.getByRole('button', { name: 'Verify' }).click();
  await expect(page).toHaveURL(/\/records$/);
});

test('mfa: a recovery code works instead of the app @mock', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Login').fill('mfa.agent');
  await page.getByLabel('Password').fill('mock-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('button', { name: /Use a recovery code/ }).click();
  await page.getByLabel('Recovery code').fill('abcde-fghij');
  await page.getByRole('button', { name: 'Verify' }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
});

test('mfa: setting up an authenticator shows a QR code, then the recovery codes once @mock', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Login').fill('enrol.agent');
  await page.getByLabel('Password').fill('mock-password');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('img', { name: /QR code/ })).toBeVisible();
  await expect(page.getByText('JBSW Y3DP EHPK 3PXP')).toBeVisible();
  await page.getByLabel('Code from the app').fill('123456');
  await page.getByRole('button', { name: 'Confirm' }).click();

  const codes = page.getByRole('list', { name: 'Recovery codes' });
  await expect(codes.getByRole('listitem')).toHaveCount(10);
  // Not signed in until the codes have been seen.
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: /I.ve saved them, continue/ }).click();
  await page.waitForURL((url) => url.pathname !== '/login');
});

import { expect, test as base, type Locator, type Page } from '@playwright/test';

/** Demo accounts served by the MSW fake BFF */
export const accounts = {
  manager: { login: 'admin', password: 'admin', name: 'Alex Morgan' },
  agent: { login: 'agent', password: 'agent', name: 'Priya Sharma' },
} as const;

export async function signIn(page: Page, account: (typeof accounts)[keyof typeof accounts] = accounts.manager) {
  await page.goto('/login');
  await page.getByLabel('Login').fill(account.login);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Problem Management' })).toBeVisible();
}

/** Pick an option in an AsyncLookupSelect (combobox), optionally inside a dialog */
export async function pickLookup(scope: Page | Locator, label: string | RegExp, search: string, option: string | RegExp) {
  const combobox = scope.getByRole('combobox', { name: label });
  await combobox.click();
  await combobox.fill(search);
  await scope.getByRole('option', { name: option }).first().click();
}

export const test = base.extend<{ signedIn: Page }>({
  // (Playwright's `use` callback, renamed so the React hooks lint rule does not misfire)
  signedIn: async ({ page }, provide) => {
    await signIn(page);
    await provide(page);
  },
});

export { expect };

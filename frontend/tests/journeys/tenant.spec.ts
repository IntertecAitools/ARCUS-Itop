import { accounts, expect, signIn, test } from './support/fixtures';

/**
 * A customer's administrator runs their own organisation (mock: "Northwind",
 * src/mocks/handlers/tenant-admin.ts), re-brands the site, and an end user
 * switches the interface to Arabic.
 */

test('organisation admin: organisations, team members and email domains', { tag: '@mock' }, async ({ page }) => {
  await signIn(page, accounts.staff());
  await page.goto('/organisation');
  await expect(page.getByRole('heading', { level: 1, name: /Organisation admin · Northwind/ })).toBeVisible();

  // A new organisation, under one of theirs.
  await page.getByLabel('Name', { exact: true }).fill('Northwind Labs');
  await page.getByLabel('Parent organisation').selectOption({ label: 'Northwind HQ' });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Northwind Labs' })).toBeVisible();

  // A team member, found by name.
  await page.getByRole('tab', { name: 'Teams' }).click();
  await page.getByLabel('Add a member').fill('grace');
  await page.getByRole('button', { name: /Grace Hopper/ }).click();
  await expect(page.getByRole('button', { name: 'Remove Grace Hopper from the team' })).toBeVisible();

  // A public mail provider is refused, with the reason announced.
  await page.getByRole('tab', { name: 'Domains' }).click();
  await expect(page.getByText('@northwind.example')).toBeVisible();
  await page.getByLabel('Domain', { exact: true }).fill('gmail.com');
  await page.getByRole('button', { name: 'Add domain' }).click();
  await expect(page.getByRole('alert')).toContainText('public mail provider');
  // Host names are the platform operator's: shown, not editable here.
  await expect(page.getByText('northwind.servicedesk.example')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add address' })).toHaveCount(0);
});

test('branding: product name and colour apply to the whole app at once', { tag: '@mock' }, async ({ page }) => {
  await signIn(page, accounts.staff());
  await page.goto('/organisation');
  await page.getByRole('tab', { name: 'Branding' }).click();
  await page.getByLabel('Product name').fill('Northwind Desk');
  await page.getByLabel('Brand colour', { exact: true }).last().fill('#0ea5e9');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  await expect(page).toHaveTitle('Northwind Desk');
  // The violet tokens now follow the brand colour, darkened so white text on it stays readable.
  // A string: the journeys compile without the DOM library.
  const brand = await page.evaluate<string>(
    "getComputedStyle(document.querySelector('[data-public-theme]')).getPropertyValue('--arcus-brand').trim()",
  );
  expect(brand).not.toBe('#6d4aff');
  expect(brand).toMatch(/^#[0-9a-f]{6}$/);
});

test('switching to Arabic mirrors the app and is remembered', { tag: '@mock' }, async ({ page }) => {
  await signIn(page, accounts.staff());
  await page.getByLabel('Choose language').first().selectOption('ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('navigation').getByText('لوحة المعلومات').first()).toBeVisible();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  await page.getByLabel('اختر اللغة').first().selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('self-registration by work email', { tag: '@mock' }, async ({ page }) => {
  await page.goto('/register');
  await page.getByLabel('First name').fill('Pat');
  await page.getByLabel('Last name').fill('Lee');
  await page.getByLabel('Work email').fill('pat@northwind.example');
  await page.getByRole('button', { name: 'Send me the link' }).click();
  await expect(page.getByText(/sent a link to set your password/)).toBeVisible();
});

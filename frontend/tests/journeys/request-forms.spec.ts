import { accounts, expect, signIn, stamp, test } from './support/fixtures';

/**
 * Request forms and the requester's target date, on the mock build: the
 * mock "Hardware" service asks which device (required) and by when. The
 * BFF side (validation, the description block, iTop's SLA deadline) is
 * covered live by backend/scripts/e2e-requests.mjs.
 */
test('portal: a service’s questions must be answered, and land in the request with its target date', { tag: '@mock' }, async ({ page }) => {
  await signIn(page, accounts.portal());
  await page.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'New request' }).click();

  await page.getByRole('button', { name: /Hardware/ }).click();
  await expect(page.getByText('What we need to know')).toBeVisible();
  const title = `New laptop ${stamp()}`;
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description', { exact: true }).fill('For the new starter.');

  const submit = page.getByRole('button', { name: 'Submit request' });
  await expect(submit).toBeDisabled();
  await expect(page.getByText('Still to answer: Device')).toBeVisible();
  await page.getByLabel('Device').selectOption('Laptop');
  await page.getByLabel('Needed by').fill('2026-11-02');
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText(/- Device: Laptop/)).toBeVisible();
  await expect(page.getByText(/- Needed by: 2026-11-02/)).toBeVisible();
  await expect(page.getByTestId('target-date')).toContainText('Expected to be resolved by');
});

test('portal: a service with no questions asks none', { tag: '@mock' }, async ({ page }) => {
  await signIn(page, accounts.portal());
  await page.goto('/portal/new');
  await page.getByRole('button', { name: /Network access/ }).click();
  await expect(page.getByText('What we need to know')).toHaveCount(0);
});

test('admin: add a question to a service’s request form', { tag: '@mock' }, async ({ page }) => {
  await signIn(page, accounts.staff());
  await page.goto('/request-forms');
  await expect(page.getByRole('heading', { name: 'Request forms' })).toBeVisible();
  await page.getByRole('link', { name: /Hardware/ }).click();

  await expect(page.getByRole('heading', { name: 'Hardware' })).toBeVisible();
  await page.getByRole('button', { name: 'Add question' }).click();
  const label = page.getByPlaceholder('e.g. Laptop model').last();
  await label.fill('Cost centre');
  // The preview shows the new question as people will see it.
  await expect(page.getByLabel('Cost centre')).toBeVisible();
  await page.getByRole('button', { name: 'Save form' }).click();
  await expect(page.getByText(/Last saved .* by Mock Administrator/)).toBeVisible();
});

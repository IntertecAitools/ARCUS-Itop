import { accounts, expect, signIn, stamp, test } from './support/fixtures';

/**
 * An end user on the self-service portal: sign in, raise a request, find it
 * in their list, add a comment. Live, this creates a real User Request.
 */
test('portal: sign in → raise a request → see it in the list → comment', async ({ page }) => {
  await signIn(page, accounts.portal());
  // End users land on the portal, never the staff app.
  await expect(page).toHaveURL(/\/portal$/);
  await expect(page.getByRole('heading', { name: /^Hello,/ })).toBeVisible();

  const nav = page.getByRole('navigation', { name: 'Portal' });
  await nav.getByRole('link', { name: 'New request' }).click();
  const title = `Printer jams on floor 3 ${stamp()}`;
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('Every second page jams. Raised by an end-to-end test.');
  await page.getByLabel('How urgent is it?').selectOption('3');
  await page.getByRole('button', { name: 'Submit request' }).click();

  await expect(page).toHaveURL(/\/portal\/requests\/\d+$/);
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  await nav.getByRole('link', { name: 'My requests' }).click();
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.getByText(title).click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const message = `Also happens on the colour printer (${stamp()}).`;
  const box = page.getByPlaceholder('Write a message to the support team…');
  await box.fill(message);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText(message)).toBeVisible();
  await expect(box).toHaveValue('');
});

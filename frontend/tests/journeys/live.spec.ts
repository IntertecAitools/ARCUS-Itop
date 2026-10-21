import type { Browser, Page } from '@playwright/test';
import { accounts, expect, signIn, stamp, test, type Account } from './support/fixtures';
import { waitForEmail } from './support/mailpit';
import { BFF_URL, FRONTEND_URL } from './support/target';

/**
 * What only the real stack can prove: real sign-in against iTop's accounts, a
 * ticket iTop creates and moves through its own lifecycle, and the emails
 * iTop and the BFF send arriving in Mailpit.
 *
 * Each run creates one User Request (left in iTop, titled with the run's
 * stamp) and one notification rule, deleted again at the end so it emails
 * nobody after the run.
 */

async function signedIn(browser: Browser, account: Account): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, account);
  return page;
}

/** Fills what iTop prompts for on a lifecycle action, then applies it. */
async function applyAction(page: Page, action: string, fill: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) {
  await page.getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await fill(dialog);
  await dialog.getByRole('button', { name: action, exact: true }).click();
  // iTop applies an action in one write but can be slow about it under load.
  await expect(dialog).toBeHidden({ timeout: 120_000 });
}

test('a portal request, resolved by staff, emails the caller and rings their bell', { tag: '@live' }, async ({ browser }) => {
  // Several slow iTop writes in a row (the rule alone is four objects).
  test.setTimeout(600_000);
  const run = `E2E ${stamp()}`;
  const staff = await signedIn(browser, accounts.staff());
  // The save's answer, however late: iTop can take over a minute to create a
  // rule, and a rule created after a failure must still be deleted.
  let saved: Promise<number | undefined> | undefined;

  try {
    // 1. An administrator creates the rule, narrowed to this run's ticket so
    //    nobody else's request triggers it.
    await staff.goto('/notifications/new');
    await staff.locator('#rule-name').fill(`${run} resolved`);
    await staff.locator('#state').selectOption({ label: 'Resolved' });
    await staff.getByRole('button', { name: 'Add condition' }).click();
    await staff.getByLabel('Field', { exact: true }).selectOption({ label: 'Title' });
    await staff.getByLabel('Condition', { exact: true }).selectOption('contains');
    await staff.getByLabel('Value', { exact: true }).fill(run);
    await staff.getByLabel('Subject').fill(`${run}: {{ref}} is resolved`);
    await staff.locator('#body').fill('Hello {{caller}},\n\n{{ref}} is resolved.\n\n{{link}}');
    await staff.getByLabel('On: send to the recipients').check();
    await staff.locator('#in-app-message').fill(`${run}: {{ref}} is resolved`);
    saved = staff
      .waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/admin/notifications/rules'), { timeout: 200_000 })
      .then(async (r) => (r.ok() ? ((await r.json()) as { id: number }).id : undefined))
      .catch(() => undefined);
    await staff.getByRole('button', { name: 'Create rule' }).click();
    await expect(staff).toHaveURL(/\/notifications\/\d+$/, { timeout: 180_000 });

    // 2. The end user raises a request from the portal.
    const portal = await signedIn(browser, accounts.portal());
    await expect(portal).toHaveURL(/\/portal$/);
    await portal.getByRole('navigation', { name: 'Portal' }).getByRole('link', { name: 'New request' }).click();
    const title = `${run} badge reader at reception`;
    await portal.getByLabel('Title').fill(title);
    await portal.getByLabel('Description').fill('The reader rejects every card. Raised by an end-to-end test.');
    await portal.getByRole('button', { name: 'Submit request' }).click();
    await expect(portal).toHaveURL(/\/portal\/requests\/\d+$/);
    const id = /\/portal\/requests\/(\d+)$/.exec(portal.url())![1];
    await expect(portal.getByRole('heading', { name: title })).toBeVisible();

    // 3. Staff find it in iTop's own record, assign it to themselves and resolve it.
    await staff.goto(`/records/UserRequest/${id}`);
    await expect(staff.getByRole('heading', { name: title, level: 1 })).toBeVisible();
    await applyAction(staff, 'Assign', async (dialog) => {
      await dialog.locator('#field-team_id').selectOption({ index: 1 });
      await dialog.locator('#field-agent_id').selectOption({ label: process.env.E2E_STAFF_NAME ?? '' });
    });
    await applyAction(staff, 'Mark as resolved', async (dialog) => {
      const service = dialog.locator('#field-service_id');
      if ((await service.count()) && !(await service.inputValue())) await service.selectOption({ index: 1 });
      const code = dialog.locator('#field-resolution_code');
      if (await code.count()) await code.selectOption('assistance');
      await dialog.locator('#field-solution').fill('Re-seated the reader and re-synced its card list.');
    });
    await expect(staff.getByText('Resolved').first()).toBeVisible();

    // 4. iTop emailed the caller, with a link back into this platform.
    const email = await waitForEmail(`subject:"${run}"`);
    expect(email.To.map((t) => t.Address)).toContain(process.env.E2E_PORTAL_EMAIL);
    expect(email.Subject).toContain(`${run}: R-`);
    expect(email.text).toContain(`/records/UserRequest/${id}`);

    // 5. The caller sees it resolved, and the in-app notice is in their bell.
    await portal.reload();
    await expect(portal.getByText('Resolved').first()).toBeVisible();
    await expect(portal.getByText('Re-seated the reader')).toBeVisible();
    await portal.getByRole('button', { name: /^Notifications, \d+ unread$/ }).click();
    const notice = portal.getByRole('dialog', { name: 'Notifications' }).getByRole('button', { name: new RegExp(run) });
    await expect(notice).toBeVisible();
    await notice.click();
    await expect(portal).toHaveURL(new RegExp(`/portal/requests/${id}$`));
  } finally {
    // The rule must not outlive the run. Deleted through the BFF directly, so
    // it goes even when a step above failed on screen.
    const ruleId = await saved;
    if (ruleId) {
      const response = await staff.context().request.delete(`${BFF_URL}/admin/notifications/rules/${ruleId}`, {
        headers: { origin: FRONTEND_URL },
      });
      expect(response.status(), 'deleting the run’s notification rule').toBeLessThan(300);
    }
  }
});

test('forgot password emails a reset link that works', { tag: '@live' }, async ({ page }) => {
  const portal = accounts.portal();
  await page.goto('/forgot-password');
  await page.getByLabel('Login or email').fill(portal.login);
  // Mailpit stores whole seconds; a little slack keeps this run's email in.
  const since = new Date(Date.now() - 2_000);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText(/If an account matches/)).toBeVisible();

  // The link points at this frontend's reset page, the token in the fragment.
  const email = await waitForEmail(`to:"${process.env.E2E_PORTAL_EMAIL}"`, { since });
  const link = /https?:\/\/\S+\/reset-password#token=[\w-]+/.exec(email.text)?.[0];
  expect(link, 'a reset link in the email').toBeTruthy();
  const path = new URL(link!);
  await page.goto(`${path.pathname}${path.hash}`);

  const password = `E2e-${stamp()}-Reset9`;
  await page.getByLabel('New password').fill(password);
  await page.getByLabel('Type it again').fill(password);
  await page.getByRole('button', { name: 'Set new password' }).click();
  await expect(page.getByText('Your password has been changed.')).toBeVisible();

  // The new password signs in. Later tests in this worker use it too;
  // live-setup gives the account a fresh one next run.
  await signIn(page, { login: portal.login, password });
  await expect(page).toHaveURL(/\/portal$/);
  process.env.E2E_PORTAL_PASSWORD = password;
});

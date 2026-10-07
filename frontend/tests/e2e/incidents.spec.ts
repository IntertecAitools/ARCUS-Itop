import { expect, test, type Page } from '@playwright/test';

/**
 * Incidents end-to-end against the REAL stack: frontend -> backend -> iTop.
 *
 * No mocks. Every incident these tests raise is a real iTop ticket, and the
 * lifecycle assertions are checked against iTop's own state machine -- which is
 * the point: a mock cannot tell you that iTop derives priority, or that it
 * rejects a stimulus the UI thought was legal.
 *
 * Each test raises its own incident with a unique title rather than sharing
 * fixtures, so the suite is order-independent and safe to run in parallel
 * against a database other tests are also writing to.
 */

/** Unique per run, so a title can never collide with an earlier run's data. */
const stamp = () => `${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

async function raiseIncident(page: Page, title: string) {
  await page.goto('/incidents/new');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('Raised by an end-to-end test.');
  await page.getByRole('button', { name: 'Raise incident' }).click();
  // Lands on the detail page once the server responds.
  await expect(page).toHaveURL(/\/incidents\/\d+$/);
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
}

test('raises an incident and lands on its detail page', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const title = `Printer offline in the finance room ${stamp()}`;
  await raiseIncident(page, title);

  // A brand-new incident is unassigned, so the only action is Assign.
  await expect(page.getByRole('button', { name: 'Assign', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resolve' })).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('the create form refuses to submit without a title or description', async ({ page }) => {
  await page.goto('/incidents/new');
  await page.getByRole('button', { name: 'Raise incident' }).click();

  await expect(page.getByText('A title is required')).toBeVisible();
  await expect(page.getByText('Describe what is happening')).toBeVisible();
  // Still on the form — nothing was sent.
  await expect(page).toHaveURL(/\/incidents\/new$/);
});

test('walks an incident through assign, comment and resolve', async ({ page }) => {
  await raiseIncident(page, `Shared drive unreachable ${stamp()}`);

  // Assign needs an agent, so the confirm button stays disabled until one is
  // chosen — the UI enforces the same requirement the API does.
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  const confirmAssign = page.getByRole('button', { name: /Confirm assign/i });
  await expect(confirmAssign).toBeDisabled();
  // Pick whichever agent this iTop actually has rather than assuming an id.
  const agent = page.getByLabel('Agent');
  await agent.selectOption({ index: 1 });
  await confirmAssign.click();

  await expect(page.getByRole('button', { name: 'Resolve' })).toBeVisible();

  // Post an update to the case log.
  await page.getByLabel('New activity entry').fill('Rebuilt the SMB share.');
  await page.getByRole('button', { name: 'Post update' }).click();
  await expect(page.getByText('Rebuilt the SMB share.')).toBeVisible();

  // Resolve requires a solution.
  await page.getByRole('button', { name: 'Resolve' }).click();
  const confirmResolve = page.getByRole('button', { name: /Confirm resolve/i });
  await expect(confirmResolve).toBeDisabled();
  await page.getByLabel('Resolution', { exact: true }).fill('Recreated the share and remounted it.');
  await confirmResolve.click();

  // Once resolved, the available actions change to close/reopen.
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resolve' })).toHaveCount(0);
});

test('a new incident appears in the queue and can be filtered', async ({ page }) => {
  const title = `Monitor flickering on desk 12 ${stamp()}`;
  await raiseIncident(page, title);

  await page.goto('/incidents');
  await expect(page.getByText(title)).toBeVisible();

  // Filtering to a status this incident is not in hides it. We assert on THIS
  // incident rather than on an empty table: the database is shared, so other
  // closed incidents may legitimately exist.
  await page.getByLabel('Filter by status').selectOption('closed');
  await expect(page.getByText(title)).toHaveCount(0);

  // The filter is in the URL, so it survives a reload.
  await page.reload();
  await expect(page.getByLabel('Filter by status')).toHaveValue('closed');

  await page.getByRole('button', { name: /Clear/ }).click();
  await expect(page.getByText(title)).toBeVisible();
});

test('search narrows the queue and is reflected in the URL', async ({ page }) => {
  const token = stamp();
  const wanted = `Badge reader rejecting all cards ${token}`;
  const other = `Projector lamp failed ${token}`;
  await raiseIncident(page, wanted);
  await raiseIncident(page, other);

  await page.goto('/incidents');
  await page.getByLabel('Search incidents').fill(`Badge reader rejecting all cards ${token}`);

  await expect(page).toHaveURL(/q=Badge/);
  await expect(page.getByText(wanted)).toBeVisible();
  await expect(page.getByText(other)).toHaveCount(0);
});

test('an unknown incident id shows a not-found page rather than crashing', async ({ page }) => {
  await page.goto('/incidents/999999');
  await expect(page.getByRole('heading', { name: 'Incident not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to incidents' })).toBeVisible();
});

test('edits an incident and the change persists in iTop', async ({ page }) => {
  const title = `Keyboard unresponsive ${stamp()}`;
  await raiseIncident(page, title);

  await page.getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  const edited = `${title} (edited)`;
  await page.getByLabel('Title').fill(edited);
  await page.getByLabel('Urgency').selectOption('1');
  await page.getByRole('button', { name: 'Save changes' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByRole('heading', { name: edited, level: 1 })).toBeVisible();

  // Reload from iTop rather than trusting the cache: the point is that the
  // write reached the system of record, not that React updated locally.
  await page.reload();
  await expect(page.getByRole('heading', { name: edited, level: 1 })).toBeVisible();
  await expect(page.getByText('Critical', { exact: true }).first()).toBeVisible();
});

test('a closed incident cannot be edited', async ({ page }) => {
  const title = `Cable tidy request ${stamp()}`;
  await raiseIncident(page, title);

  // new -> assigned -> resolved -> closed
  await page.getByRole('button', { name: 'Assign', exact: true }).click();
  await page.getByLabel('Agent').selectOption({ index: 1 });
  await page.getByRole('button', { name: /Confirm assign/i }).click();

  await page.getByRole('button', { name: 'Resolve' }).click();
  await page.getByLabel('Resolution', { exact: true }).fill('Not required after all.');
  await page.getByRole('button', { name: /Confirm resolve/i }).click();

  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: /Confirm close/i }).click();

  // A closed incident is a record, not a work item: no actions, no Edit.
  await expect(page.getByText('This incident is closed')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0);
});

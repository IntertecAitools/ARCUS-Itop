import { expect, test } from '@playwright/test';

/**
 * The Records module is the generic screen over the whole iTop datamodel: one
 * UI driven by the schema the BFF publishes, rather than a hand-built page per
 * class. That is what makes every class reachable, and it is also why it needs
 * its own coverage — a schema change can break 125 pages at once.
 *
 * Assertions are structural on purpose. These run against a real iTop whose
 * contents change, and most classes are legitimately empty, so pinning row
 * counts would fail for the wrong reason.
 */

test('the index lists classes grouped, and links into them', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/records');
  await expect(page.getByRole('heading', { name: 'Records', level: 1 })).toBeVisible();

  // The schema arrived and produced links. 100 is well under the ~125 concrete
  // classes, so this catches a collapsed schema without pinning an exact count.
  const classLinks = page.locator('a[href^="/records/"]');
  await expect(classLinks.first()).toBeVisible();
  expect(await classLinks.count()).toBeGreaterThan(100);

  expect(errors).toEqual([]);
});

test('the filter narrows the class list', async ({ page }) => {
  await page.goto('/records');
  await expect(page.locator('a[href^="/records/"]').first()).toBeVisible();

  await page.getByLabel('Filter classes').fill('zzzznotaclass');
  await expect(page.getByText('No class matches that filter')).toBeVisible();

  await page.getByLabel('Filter classes').fill('Organization');
  await expect(page.locator('a[href="/records/Organization"]')).toBeVisible();
});

test('a populated class lists its rows', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Organization always has rows: the BFF cannot resolve a default org without
  // at least one, so an empty table here would mean the read path is broken.
  await page.goto('/records/Organization');
  await expect(page.getByRole('heading', { name: 'Organization', level: 1 })).toBeVisible();
  await expect(page.getByRole('row').nth(1)).toBeVisible();

  expect(errors).toEqual([]);
});

test('an empty class renders empty rather than erroring', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Nothing has created a change request in this iTop. "Nothing here" and
  // "something broke" must not look the same, which is the point of the check.
  await page.goto('/records/NormalChange');
  await expect(page.getByRole('heading', { name: 'NormalChange', level: 1 })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('a row opens its detail screen', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/records/Organization');
  await expect(page.getByRole('row').nth(1)).toBeVisible();

  // Scoped to a table row on purpose: the header's "New" button is also an
  // anchor under /records/Organization/, and matching it would test nothing.
  await page.getByRole('row').nth(1).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/records\/Organization\/\d+$/);
  // The generic detail screen renders the class's fields from the schema.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  expect(errors).toEqual([]);
});

test('Problem Management is reachable, as an installed iTop module', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  // Problem arrived by installing itop-problem-mgmt into iTop; no frontend
  // change was needed, because Records renders whatever the schema describes.
  // This pins both halves: the module stays installed, and the generic screen
  // keeps picking it up.
  await page.goto('/records');
  await expect(page.locator('a[href="/records/Problem"]')).toBeVisible();

  await page.goto('/records/Problem');
  await expect(page.getByRole('heading', { name: 'Problem', level: 1 })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('creates a Problem through the generic form and it persists', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const title = `e2e problem ${Date.now()}`;

  await page.goto('/records/Problem/new');
  await expect(page.getByRole('heading', { name: 'New Problem', level: 1 })).toBeVisible();

  // Fields are addressed by attribute code rather than by label: the labels are
  // derived from the schema, so asserting them here would test the humaniser
  // instead of the create path.
  await page.locator('#field-title').fill(title);
  await page.locator('#field-description').fill('Raised by the end-to-end suite.');
  await page.locator('#field-impact').selectOption({ index: 1 });
  await page.locator('#field-urgency').selectOption({ index: 1 });
  await page.locator('#field-priority').selectOption({ index: 1 });
  await page.locator('#field-org_id').selectOption({ index: 1 });

  await page.getByRole('button', { name: 'Create' }).click();

  // iTop derives priority from impact and urgency, so it may refuse the value
  // we sent. Either outcome is correct; what matters is that the record exists
  // and that a refusal is reported rather than swallowed.
  const openRecord = page.getByRole('link', { name: 'Open the record' });
  if (await openRecord.isVisible().catch(() => false)) {
    await expect(page.getByText(/did not take these fields/i)).toBeVisible();
    await openRecord.click();
  }

  await expect(page).toHaveURL(/\/records\/Problem\/\d+$/);

  // Read it back from a fresh list to prove it reached iTop, not just the form.
  await page.goto('/records/Problem');
  await page.getByLabel('Search Problem').fill(title);
  await expect(page.getByRole('cell', { name: title })).toBeVisible();

  expect(errors).toEqual([]);
});

test("a record is laid out the way iTop lays it out", async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const title = `e2e layout ${Date.now()}`;
  await page.goto('/records/Problem/new');
  await page.locator('#field-title').fill(title);
  await page.locator('#field-description').fill('Checking iTop’s own form layout.');
  await page.locator('#field-impact').selectOption({ index: 1 });
  await page.locator('#field-urgency').selectOption({ index: 1 });
  await page.locator('#field-priority').selectOption({ index: 1 });
  await page.locator('#field-org_id').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Create' }).click();

  const openRecord = page.getByRole('link', { name: 'Open the record' });
  if (await openRecord.isVisible().catch(() => false)) await openRecord.click();
  await expect(page).toHaveURL(/\/records\/Problem\/\d+$/);

  const main = page.getByRole('main');

  // iTop's fieldsets, by iTop's names, in iTop's order. Nothing in the
  // frontend names these: they come from <presentation><details> via the BFF.
  // Matched on the data attribute rather than the text, because "Contacts" is
  // both a fieldset and a tab. The upper-case look is a CSS transform, and
  // toHaveText reads textContent, so these are iTop's own strings.
  await expect(main.locator('p[data-fieldset]')).toHaveText([
    'General Information',
    'More Information',
    'Qualification',
    'Dates',
    'Contacts',
    'Relations',
    // Attributes the class has that iTop's layout does not place.
    'Other',
  ]);

  // iTop's field wording, not the attribute code.
  await expect(main.getByText('Service subcategory', { exact: true })).toBeVisible();
  await expect(main.getByText('Related Change', { exact: true })).toBeVisible();

  // A picker shows the name behind the id, not the raw integer. Asserted as
  // "not a bare number" rather than against one organisation's name, because
  // the form picks whichever the instance happens to have.
  const organization = main.locator('dd[data-field="org_id"]');
  await expect(organization).toBeVisible();
  await expect(organization).not.toHaveText(/^\s*\d+\s*$/);

  // A CaseLog is iTop's comment stream, not a string: rendering it naively
  // prints "[object Object]".
  await expect(main.getByText('[object Object]')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test("related objects appear as tabs, and lifecycle actions as buttons", async ({ page }) => {
  await page.goto('/records/Problem');
  await page.getByRole('row').nth(1).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/records\/Problem\/\d+$/);

  // iTop declares these related lists on the Problem form; the detail screen
  // used to drop LinkedSets entirely, which is most of what a ticket is about.
  for (const tab of ['Details', 'CIs', 'Contacts', 'Known Errors']) {
    await expect(page.getByRole('tab', { name: tab })).toBeVisible();
  }

  await page.getByRole('tab', { name: 'Contacts' }).click();
  await expect(page.getByText('Nothing linked yet', { exact: true })).toBeVisible();
  // iTop's link classes (lnkContactToTicket) must not surface to the reader.
  await expect(page.getByText(/lnk[A-Z]/)).toHaveCount(0);

  // A new Problem is in state `new`, whose only transition iTop allows is
  // assignment — so exactly one action, labelled the way iTop labels it.
  await page.getByRole('tab', { name: 'Details' }).click();
  await expect(page.getByRole('button', { name: 'Assign' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close' })).toHaveCount(0);
});

test('every tab iTop declares opens without an error', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (e) => problems.push(String(e)));
  page.on('response', (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });

  // iTop promotes two different kinds of attribute to tabs: LinkedSets, which
  // list other objects, and CaseLogs, which are comment streams. Treating them
  // alike sent a CaseLog to the links endpoint and returned 400 on click --
  // a failure no test caught because none of them opened every tab.
  await page.goto('/records/Incident/new');
  await page.locator('#field-title').fill(`e2e tabs ${Date.now()}`);
  await page.locator('#field-description').fill('Opens every tab.');
  await page.locator('#field-org_id').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Create' }).click();
  const openRecord = page.getByRole('link', { name: 'Open the record' });
  if (await openRecord.isVisible().catch(() => false)) await openRecord.click();
  await expect(page).toHaveURL(/\/records\/Incident\/\d+$/);
  const id = page.url().match(/\/(\d+)$/)?.[1];

  try {
    await expect(page.getByRole('tab', { name: 'Details' })).toBeVisible({ timeout: 60_000 });
    const names = await page.getByRole('tab').allInnerTexts();
    expect(names.length).toBeGreaterThan(4);
    // Both kinds must be present, or this would pass without covering the case
    // that broke.
    expect(names).toContain('Public log');
    expect(names).toContain('Contacts');

    for (const name of names) {
      await page.getByRole('tab', { name, exact: true }).click();
      await expect(page.getByRole('alert')).toHaveCount(0);
    }

    expect(problems).toEqual([]);
  } finally {
    if (id) {
      await page.request.delete(
        `http://localhost:4000/api/objects/Incident/${id}?comment=e2e cleanup`,
      );
    }
  }
});

test('a list uses the columns iTop declares', async ({ page }) => {
  await page.goto('/records/Problem');
  await expect(page.getByRole('heading', { name: 'Problem', level: 1 })).toBeVisible();

  // iTop's <presentation><list> for Problem, in order, with iTop's wording.
  for (const header of ['Title', 'Organization', 'Start date', 'Status', 'Service', 'Priority']) {
    await expect(page.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
  }
});

test('an unknown class does not pretend to exist', async ({ page }) => {
  await page.goto('/records/NoSuchClass');

  // iTop answers 200 for everything, so the BFF has to turn an unknown class
  // into a real error. The UI gives it a whole screen rather than an error
  // banner over an empty table, so the distinction from "no rows" is obvious.
  await expect(page.getByRole('heading', { name: 'Unknown class', level: 1 })).toBeVisible();
  await expect(page.getByText('iTop has no class called "NoSuchClass"')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Back to records' })).toBeVisible();
});

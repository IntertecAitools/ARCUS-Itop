import { expect, test } from '@playwright/test';

/**
 * Attachments, end to end against real iTop.
 *
 * Nothing is stubbed: the file is uploaded through the BFF, stored by iTop as
 * an `Attachment` row with a base64 Blob, read back, downloaded and deleted.
 * A mocked version of this would prove only that the component renders.
 *
 * Each test creates the ticket it needs and removes it afterwards, so the
 * instance is left as it was found.
 */

/**
 * Headroom for a step that is several iTop round trips deep.
 *
 * playwright.config sets 45s per assertion, sized for one call against an
 * instance that answers in 6-8 seconds. An upload is a create plus a read-back
 * plus a list refetch, and the first test in a run also pays for a cold preview
 * server. This is the real latency of the system, not a flaky assertion.
 */
const ITOP_ROUND_TRIP = 120_000;

const UPLOAD = {
  name: 'intertec-e2e.txt',
  mimeType: 'text/plain',
  body: 'attachment round-trip, written by the end-to-end suite\n',
};

/** Creates an incident through the UI and returns its record URL. */
async function newIncident(page: import('@playwright/test').Page, title: string) {
  await page.goto('/records/Incident/new');
  await page.locator('#field-title').fill(title);
  await page.locator('#field-description').fill('Created by the attachment e2e.');
  await page.locator('#field-org_id').selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Create' }).click();

  const openRecord = page.getByRole('link', { name: 'Open the record' });
  if (await openRecord.isVisible().catch(() => false)) await openRecord.click();
  await expect(page).toHaveURL(/\/records\/Incident\/\d+$/);
  return page.url();
}

/** Removes the incident again, so a passing run leaves no rows behind. */
async function deleteIncident(page: import('@playwright/test').Page, url: string) {
  const id = url.match(/\/records\/Incident\/(\d+)$/)?.[1];
  if (!id) return;
  await page.request.delete(`http://localhost:4000/api/objects/Incident/${id}?comment=e2e cleanup`);
}

test('uploads, lists, downloads and deletes a real attachment', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));

  const url = await newIncident(page, `e2e attachment ${Date.now()}`);

  try {
    // 1-3. The tab exists on a ticket, and starts empty.
    await page.getByRole('tab', { name: 'Attachments' }).click();
    await expect(page.getByText('No attachments yet')).toBeVisible();

    // 4-5. Upload a real file.
    await page.getByLabel('Choose a file to attach').setInputFiles({
      name: UPLOAD.name,
      mimeType: UPLOAD.mimeType,
      buffer: Buffer.from(UPLOAD.body),
    });

    // 6. It appears, with metadata iTop actually returned: the size is the
    // decoded byte length, and the uploader is the account the BFF writes as.
    const row = page.locator('[data-attachment]');
    await expect(row).toHaveCount(1, { timeout: ITOP_ROUND_TRIP });
    await expect(row).toContainText(UPLOAD.name);
    await expect(row).toContainText(`${Buffer.byteLength(UPLOAD.body)} B`);
    await expect(row).toContainText('text/plain');
    await expect(row).toContainText('by admin');

    // 7-8. Download it and check the bytes survived the base64 round trip.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Download' }).click(),
    ]);
    expect(download.suggestedFilename()).toBe(UPLOAD.name);
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe(UPLOAD.body);

    // 9-10. Delete, behind a confirmation.
    await page.getByRole('button', { name: `Delete ${UPLOAD.name}` }).click();
    await expect(page.getByText('Delete this file?')).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();

    // The row going is the claim; the empty state following from it is the
    // consequence.
    await expect(page.locator('[data-attachment]')).toHaveCount(0, {
      timeout: ITOP_ROUND_TRIP,
    });
    await expect(page.getByText('No attachments yet')).toBeVisible();

    expect(errors).toEqual([]);
  } finally {
    await deleteIncident(page, url);
  }
});

test('the attachment survives a reload, so it really is in iTop', async ({ page }) => {
  const url = await newIncident(page, `e2e persist ${Date.now()}`);

  try {
    await page.getByRole('tab', { name: 'Attachments' }).click();
    await page.getByLabel('Choose a file to attach').setInputFiles({
      name: 'persisted.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('stored in iTop'),
    });
    await expect(page.locator('[data-attachment]')).toHaveCount(1, {
      timeout: ITOP_ROUND_TRIP,
    });

    // A fresh page proves the row came back from iTop rather than from
    // component state left over after the upload.
    await page.reload();
    await page.getByRole('tab', { name: 'Attachments' }).click();
    await expect(page.getByText('persisted.txt')).toBeVisible();
  } finally {
    await deleteIncident(page, url);
  }
});

test('an empty file is refused before it is sent', async ({ page }) => {
  const url = await newIncident(page, `e2e empty ${Date.now()}`);

  try {
    await page.getByRole('tab', { name: 'Attachments' }).click();
    await page.getByLabel('Choose a file to attach').setInputFiles({
      name: 'empty.txt',
      mimeType: 'text/plain',
      buffer: Buffer.alloc(0),
    });

    await expect(page.getByRole('alert')).toContainText('empty');
    await expect(page.locator('[data-attachment]')).toHaveCount(0);
  } finally {
    await deleteIncident(page, url);
  }
});

test('a class iTop does not attach to has no attachments tab', async ({ page }) => {
  // itop-attachments allows Ticket and its subclasses. Organization is not one,
  // so offering the tab would present an upload that always fails.
  await page.goto('/records/Organization');
  await page.getByRole('row').nth(1).getByRole('link').first().click();
  await expect(page).toHaveURL(/\/records\/Organization\/\d+$/);

  await expect(page.getByRole('tab', { name: 'Attachments' })).toHaveCount(0);
});

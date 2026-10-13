import { http, HttpResponse } from 'msw';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { server } from '@/mocks/server';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { AttachmentsPanel } from './AttachmentsPanel';

/**
 * Component behaviour for the attachment panel.
 *
 * HTTP is stubbed here on purpose: these cover states that are awkward or
 * slow to force against a real server — a 413, a network failure, a delete
 * the user cancels. The real round trip (upload, store, download, delete) is
 * covered end to end against live iTop in tests/e2e/attachments.spec.ts, so
 * nothing here is standing in for that.
 */

const URL = 'http://localhost:4000/api/objects/Incident/7/attachments';

const attachment = {
  id: '3',
  filename: 'runbook.pdf',
  mimeType: 'application/pdf',
  size: 2048,
  uploadedAt: '2026-10-12 09:30:00',
  uploadedBy: { id: '1', name: 'admin' },
  downloads: 0,
};

const listReturns = (items: unknown[]) =>
  http.get(URL, () =>
    HttpResponse.json({ items, total: items.length, item: { class: 'Incident', id: '7' } }),
  );

function panel() {
  return renderWithProviders(<AttachmentsPanel className="Incident" id="7" />);
}

describe('AttachmentsPanel', () => {
  it('shows a loading state before the list arrives', async () => {
    server.use(listReturns([]));
    const { container } = panel();

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    await screen.findByText('No attachments yet');
  });

  it('shows an empty state when the record has none', async () => {
    server.use(listReturns([]));
    panel();

    expect(await screen.findByText('No attachments yet')).toBeInTheDocument();
  });

  it('renders real metadata for an existing attachment', async () => {
    server.use(listReturns([attachment]));
    panel();

    expect(await screen.findByText('runbook.pdf')).toBeInTheDocument();
    // Size formatted from the byte count the BFF computed, uploader from iTop.
    expect(screen.getByText(/2\.0 KB/)).toBeInTheDocument();
    expect(screen.getByText(/application\/pdf/)).toBeInTheDocument();
    expect(screen.getByText(/by admin/)).toBeInTheDocument();
  });

  it('surfaces a failure to load rather than looking empty', async () => {
    // "Nothing here" and "we could not ask" must not look the same.
    server.use(
      http.get(URL, () =>
        HttpResponse.json({ error: { code: 'forbidden', message: 'Not allowed.' } }, { status: 403 }),
      ),
    );
    panel();

    expect(await screen.findByRole('alert')).toHaveTextContent('Not allowed.');
    expect(screen.queryByText('No attachments yet')).not.toBeInTheDocument();
  });

  it('uploads a chosen file and lists it', async () => {
    let uploaded = false;
    server.use(
      http.get(URL, () =>
        HttpResponse.json({
          items: uploaded ? [attachment] : [],
          total: uploaded ? 1 : 0,
          item: { class: 'Incident', id: '7' },
        }),
      ),
      http.post(URL, () => {
        // Deliberately not asserting the multipart body here: jsdom's FormData
        // and the fetch implementation under Vitest are different realms, so
        // the encoding this sees is an artefact of the test environment rather
        // than of the app. The real encoding is covered where it is real --
        // tests/e2e/attachments.spec.ts uploads through a browser, and the BFF
        // rejects anything that is not multipart with a 415.
        uploaded = true;
        return HttpResponse.json(attachment, { status: 201 });
      }),
    );
    panel();
    await screen.findByText('No attachments yet');

    await userEvent.upload(
      screen.getByLabelText('Choose a file to attach'),
      new File(['%PDF-1.4'], 'runbook.pdf', { type: 'application/pdf' }),
    );

    expect(await screen.findByText('runbook.pdf')).toBeInTheDocument();
    expect(screen.getByText(/Uploaded runbook\.pdf/)).toBeInTheDocument();
  });

  it("reports the server's reason when an upload is refused", async () => {
    server.use(
      listReturns([]),
      http.post(URL, () =>
        HttpResponse.json(
          { error: { code: 'payload_too_large', message: 'That file is larger than the 32 MB limit.' } },
          { status: 413 },
        ),
      ),
    );
    panel();
    await screen.findByText('No attachments yet');

    await userEvent.upload(
      screen.getByLabelText('Choose a file to attach'),
      new File(['x'], 'big.bin', { type: 'application/octet-stream' }),
    );

    expect(await screen.findByText(/larger than the 32 MB limit/)).toBeInTheDocument();
  });

  it('refuses an empty file without calling the server', async () => {
    const onPost = vi.fn();
    server.use(
      listReturns([]),
      http.post(URL, () => {
        onPost();
        return HttpResponse.json(attachment, { status: 201 });
      }),
    );
    panel();
    await screen.findByText('No attachments yet');

    await userEvent.upload(
      screen.getByLabelText('Choose a file to attach'),
      new File([], 'empty.txt', { type: 'text/plain' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('empty');
    expect(onPost).not.toHaveBeenCalled();
  });

  it('asks before deleting, and does nothing if cancelled', async () => {
    const onDelete = vi.fn();
    server.use(
      listReturns([attachment]),
      http.delete(`${URL}/3`, () => {
        onDelete();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    panel();
    await screen.findByText('runbook.pdf');

    await userEvent.click(screen.getByRole('button', { name: 'Delete runbook.pdf' }));
    expect(screen.getByText('Delete this file?')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('runbook.pdf')).toBeInTheDocument();
  });

  it('deletes once confirmed', async () => {
    let deleted = false;
    server.use(
      http.get(URL, () =>
        HttpResponse.json({
          items: deleted ? [] : [attachment],
          total: deleted ? 0 : 1,
          item: { class: 'Incident', id: '7' },
        }),
      ),
      http.delete(`${URL}/3`, () => {
        deleted = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    panel();
    await screen.findByText('runbook.pdf');

    await userEvent.click(screen.getByRole('button', { name: 'Delete runbook.pdf' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.getByText('No attachments yet')).toBeInTheDocument());
  });

  it('reports a download failure instead of saving an error page', async () => {
    server.use(
      listReturns([attachment]),
      http.get(`${URL}/3`, () =>
        HttpResponse.json({ error: { code: 'not_found', message: 'Attachment 3 was not found.' } }, { status: 404 }),
      ),
    );
    panel();
    await screen.findByText('runbook.pdf');

    await userEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(await screen.findByText('Attachment 3 was not found.')).toBeInTheDocument();
  });

  it('downloads through the api client, not a direct link', async () => {
    // A plain <a href> at the BFF would skip credentials and error handling.
    // Asserting the request happened proves the blob path is in use.
    let requested = false;
    server.use(
      listReturns([attachment]),
      http.get(`${URL}/3`, () => {
        requested = true;
        return new HttpResponse(new Blob(['pdf bytes']), {
          headers: { 'Content-Type': 'application/pdf' },
        });
      }),
    );
    // jsdom implements neither of these.
    URL_createObjectURL_stub();
    panel();
    await screen.findByText('runbook.pdf');

    await userEvent.click(screen.getByRole('button', { name: 'Download' }));

    await waitFor(() => expect(requested).toBe(true));
  });
});

/** jsdom has no object-URL support; the component only needs it to not throw. */
function URL_createObjectURL_stub() {
  Object.defineProperty(globalThis.URL, 'createObjectURL', {
    value: vi.fn(() => 'blob:stub'),
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
    value: vi.fn(),
    writable: true,
    configurable: true,
  });
}

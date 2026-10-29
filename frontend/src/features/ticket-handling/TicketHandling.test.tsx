import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { resetTicketHandlingMock } from '@/mocks/handlers/ticket-handling';
import { TicketHandlingPanel } from './components/TicketHandlingPanel';
import { DuplicateSuggestions } from './components/DuplicateSuggestions';
import { DraftBar } from './components/DraftBar';
import { useTicketDraft } from './hooks/useTicketDraft';
import { MyDraftsPage } from './pages/MyDraftsPage';
import { formatMinutes, parseDuration, parseTicketRef } from './lib/format';
import { useState } from 'react';

beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));
beforeEach(() => resetTicketHandlingMock());

describe('format helpers', () => {
  it('reads time as people type it', () => {
    expect(parseDuration('45')).toBe(45);
    expect(parseDuration('45m')).toBe(45);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('1.5h')).toBe(90);
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('0')).toBeUndefined();
    expect(parseDuration('soon')).toBeUndefined();
    expect(formatMinutes(95)).toBe('1h 35m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(30)).toBe('30m');
  });

  it('reads a ticket reference', () => {
    expect(parseTicketRef('I-000123', 'UserRequest')).toEqual({ class: 'Incident', id: 123 });
    expect(parseTicketRef('r-45', 'Incident')).toEqual({ class: 'UserRequest', id: 45 });
    expect(parseTicketRef('77', 'Incident')).toEqual({ class: 'Incident', id: 77 });
    expect(parseTicketRef('X-1', 'Incident')).toBeUndefined();
  });
});

describe('TicketHandlingPanel', () => {
  it('overrides the priority with a reason and shows the override', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TicketHandlingPanel ticketClass="Incident" id="7" />);
    await user.click(await screen.findByRole('button', { name: 'Override priority' }));
    const form = screen.getByRole('form', { name: 'Override priority' });
    const submit = within(form).getByRole('button', { name: 'Override' });
    expect(submit).toBeDisabled();
    await user.selectOptions(within(form).getByLabelText('New priority'), 'critical');
    await user.type(within(form).getByLabelText(/Reason/), 'Whole floor down');
    await user.click(submit);
    expect(await screen.findByText('Priority overridden')).toBeInTheDocument();
    expect(screen.getByText('Whole floor down')).toBeInTheDocument();
  });

  it('marks the ticket a duplicate of a suggested original', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TicketHandlingPanel ticketClass="Incident" id="8" />);
    await user.click(await screen.findByRole('button', { name: 'Mark as duplicate' }));
    const list = await screen.findByRole('list', { name: 'Likely originals' });
    expect(within(list).getByText('same caller · similar title')).toBeInTheDocument();
    await user.click(within(list).getByRole('button', { name: 'Original' }));
    expect(await screen.findByText('Duplicate of')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'I-000042' })).toHaveAttribute('href', '/incidents/42');
    // Resolved now: nothing left to do but log time.
    expect(screen.queryByRole('button', { name: 'Cancel ticket' })).not.toBeInTheDocument();
  });

  it('cancels with a reason', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TicketHandlingPanel ticketClass="UserRequest" id="9" />);
    await user.click(await screen.findByRole('button', { name: 'Cancel ticket' }));
    const form = screen.getByRole('form', { name: 'Cancel ticket' });
    await user.type(within(form).getByLabelText('Why is it cancelled?'), 'Raised twice');
    await user.click(within(form).getByRole('button', { name: 'Cancel ticket' }));
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText('Raised twice')).toBeInTheDocument();
  });

  it('logs time and shows the total, and removes an own entry', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TicketHandlingPanel ticketClass="Incident" id="10" />);
    await user.click(await screen.findByRole('button', { name: 'Log time' }));
    const form = screen.getByRole('form', { name: 'Log time' });
    await user.type(within(form).getByLabelText('Time spent'), '1h 15m');
    await user.type(within(form).getByLabelText('What was done'), 'Replaced the cable');
    await user.click(within(form).getByRole('button', { name: 'Log time' }));
    const list = await screen.findByRole('list', { name: 'Time logged' });
    expect(within(list).getByText('Replaced the cable')).toBeInTheDocument();
    expect(screen.getAllByText('1h 15m logged').length).toBeGreaterThan(0);
    await user.click(within(list).getByRole('button', { name: /Remove 1h 15m/ }));
    expect(await screen.findByRole('button', { name: 'Log time' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Time logged' })).not.toBeInTheDocument();
  });
});

describe('DuplicateSuggestions', () => {
  it('shows open tickets that look like the one being written', async () => {
    renderWithProviders(<DuplicateSuggestions ticketClass="Incident" title="VPN down at the branch" />);
    const section = await screen.findByRole('region', { name: 'Possible duplicates' });
    expect(within(section).getByRole('link', { name: 'I-000042' })).toHaveAttribute('href', '/incidents/42');
  });

  it('says nothing for a title too short to compare', async () => {
    renderWithProviders(<DuplicateSuggestions ticketClass="Incident" title="vpn" />);
    await new Promise((r) => setTimeout(r, 700));
    expect(screen.queryByRole('region', { name: 'Possible duplicates' })).not.toBeInTheDocument();
  });
});

function DraftForm() {
  const [title, setTitle] = useState('');
  const draft = useTicketDraft('incident', () => ({ title }), (data) => setTitle(String(data['title'] ?? '')));
  return (
    <>
      <label>
        Title
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <DraftBar draft={draft} />
    </>
  );
}

describe('drafts', () => {
  it('saves a half-filled form and lists it in My drafts', async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<DraftForm />, { route: '/incidents/new' });
    await user.type(screen.getByLabelText('Title'), 'Printer half done');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText(/Draft saved/)).toBeInTheDocument();
    unmount();

    renderWithProviders(<MyDraftsPage />);
    const link = await screen.findByRole('link', { name: /Printer half done/ });
    expect(link.getAttribute('href')).toMatch(/^\/records\/Incident\/new\?draft=[0-9a-f]{24}$/);
  });

  it('resumes a draft named in the address', async () => {
    const user = userEvent.setup();
    const first = renderWithProviders(<DraftForm />, { route: '/incidents/new' });
    await user.type(screen.getByLabelText('Title'), 'Resume me');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    await screen.findByText(/Draft saved/);
    first.unmount();

    renderWithProviders(<MyDraftsPage />);
    const href = (await screen.findByRole('link', { name: /Resume me/ })).getAttribute('href')!;
    renderWithProviders(<DraftForm />, { route: href });
    expect(await screen.findByDisplayValue('Resume me')).toBeInTheDocument();
  });
});

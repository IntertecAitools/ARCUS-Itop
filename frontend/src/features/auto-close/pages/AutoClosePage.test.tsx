import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen } from '@/test/render';
import { resetAutoCloseMock } from '@/mocks/handlers/auto-close';
import { AutoClosePage } from './AutoClosePage';

beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));
beforeEach(() => resetAutoCloseMock());

describe('AutoClosePage', () => {
  it('shows the defaults: on, 7 days, requests and incidents, a reminder 2 days before', async () => {
    renderWithProviders(<AutoClosePage />);
    expect(await screen.findByLabelText('Close resolved tickets automatically')).toBeChecked();
    expect(screen.getByLabelText(/Close after/)).toHaveValue(7);
    expect(screen.getByLabelText('Service requests')).toBeChecked();
    expect(screen.getByLabelText('Incidents')).toBeChecked();
    expect(screen.getByLabelText('Email the caller before the ticket closes')).toBeChecked();
    expect(screen.getByLabelText('Days before closing')).toHaveValue(2);
    expect(screen.getByText('The platform’s defaults apply.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('saves a change, and refuses a reminder on or after the closing day', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AutoClosePage />);
    const days = await screen.findByLabelText(/Close after/);
    await user.clear(days);
    await user.type(days, '3');
    const before = screen.getByLabelText('Days before closing');
    await user.clear(before);
    await user.type(before, '3');
    expect(screen.getByText('The reminder has to go at least a day before the ticket closes.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.clear(before);
    await user.type(before, '1');
    await user.click(screen.getByLabelText('Incidents'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Saved\. The next check uses them\./)).toBeInTheDocument();
    expect(screen.getByText(/Last changed by admin/)).toBeInTheDocument();
    expect(screen.getByLabelText('Incidents')).not.toBeChecked();
  });

  it('Run now shows what the check did', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AutoClosePage />);
    expect(await screen.findByText('No check since the server started.')).toBeInTheDocument();
    expect(screen.getByText('The server checks every hour.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Run now' }));
    expect(await screen.findByText(/1 closed, 1 reminded/)).toBeInTheDocument();
    expect(screen.getByText('R-000011')).toBeInTheDocument();
  });
});

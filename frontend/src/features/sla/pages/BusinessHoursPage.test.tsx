import { beforeAll, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { env } from '@/config/env';
import { server } from '@/mocks/server';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { BusinessHoursPage } from './BusinessHoursPage';

// Each step waits on a mock request, which can pass a second on a busy machine.
beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));

describe('BusinessHoursPage', () => {
  it('lists windows, holidays and contract services', async () => {
    renderWithProviders(<BusinessHoursPage />);
    const windows = await screen.findByRole('list', { name: 'Coverage windows' });
    expect(within(windows).getByText('Office hours')).toBeInTheDocument();
    expect(within(windows).getByText('Mon–Fri 09:00–17:00')).toBeInTheDocument();
    expect(within(windows).getByText('1 contract service')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: 'Holidays' })).getByText('Christmas Day')).toBeInTheDocument();
    const vpn = screen.getByLabelText('Coverage window for Support 2026: VPN');
    expect(vpn).toHaveValue('');
  });

  // The longest journey here (a full week of time inputs): more time on a loaded run.
  it('creates a window from a preset, refusing overlapping hours first, and assigns it', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<BusinessHoursPage />);
    await user.click(await screen.findByRole('button', { name: /New window/ }));

    const form = screen.getByRole('form', { name: 'New coverage window' });
    await user.type(within(form).getByLabelText('Name'), 'Weekend desk');
    await user.click(within(form).getByRole('button', { name: /Around the clock/ }));
    await user.click(within(form).getByRole('button', { name: 'Add a period on Saturday' }));
    // 24x7 plus 09:00–17:00 on Saturday overlap.
    expect(within(form).getByText('Saturday: two periods overlap.')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Create window' })).toBeDisabled();
    await user.click(within(form).getByRole('button', { name: 'Remove Saturday period 2' }));
    await user.click(within(form).getByRole('button', { name: 'Create window' }));

    const windows = await screen.findByRole('list', { name: 'Coverage windows' });
    expect(await within(windows).findByText('Weekend desk')).toBeInTheDocument();
    expect(within(windows).getByText('24x7')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Coverage window for Support 2026: VPN'), 'Weekend desk');
    await vi.waitFor(() => {
      const item = within(screen.getByRole('list', { name: 'Coverage windows' })).getByText('Weekend desk').closest('li')!;
      expect(within(item).getByText('1 contract service')).toBeInTheDocument();
    });
  }, 45_000);

  it('adds and deletes a holiday', async () => {
    const user = userEvent.setup({ delay: null });
    renderWithProviders(<BusinessHoursPage />);
    const form = await screen.findByRole('form', { name: 'New holiday' });
    const year = new Date().getFullYear() + 1;
    await user.type(within(form).getByLabelText('Holiday'), 'New Year');
    await user.type(within(form).getByLabelText('Date'), `${year}-01-01`);
    await user.click(within(form).getByRole('button', { name: 'Add holiday' }));
    const table = screen.getByRole('table', { name: 'Holidays' });
    expect(await within(table).findByText('New Year')).toBeInTheDocument();

    await user.click(within(table).getByRole('button', { name: `Delete New Year (${year}-01-01)` }));
    await vi.waitFor(() => expect(within(screen.getByRole('table', { name: 'Holidays' })).queryByText('New Year')).toBeNull());
  });

  it('explains what is missing when iTop has no business hours', async () => {
    server.use(
      http.get(`${env.bffUrl}/admin/business-hours`, () =>
        HttpResponse.json({ available: false, coverageWindows: [], calendars: [], holidays: [], assignments: [] }),
      ),
    );
    renderWithProviders(<BusinessHoursPage />);
    expect(await screen.findByText(/combodo-sla-computation and combodo-coverage-windows-computation/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New window/ })).not.toBeInTheDocument();
  });
});

import { beforeAll, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { ProblemTrendsPage } from './ProblemTrendsPage';

// jsdom has no ResizeObserver, which the chart's ResponsiveContainer needs.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// Each step waits on a mock request, which can pass a second on a busy machine.
beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));

describe('ProblemTrendsPage', () => {
  it('shows totals, flags recurring groups and filters them', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProblemTrendsPage />);

    const table = await screen.findByRole('table');
    const email = (await within(table).findByText('Email')).closest('tr')!;
    expect(within(email).getByText('Recurring')).toBeInTheDocument();
    expect(within(email).getByRole('link', { name: 'P-000035' })).toHaveAttribute('href', '/records/Problem/35');

    const vpn = within(table).getByText('VPN').closest('tr')!;
    // Recurring and no problem yet: offered as a new problem.
    expect(within(vpn).getByRole('link', { name: 'Open a problem' })).toBeInTheDocument();
    expect(within(table).getByText('Payroll')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Show'), 'recurring');
    expect(within(screen.getByRole('table')).queryByText('Payroll')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Show'), 'unlinked');
    expect(within(screen.getByRole('table')).getByText('VPN')).toBeInTheDocument();
  });

  it('regroups by configuration item and changes period', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ProblemTrendsPage />);
    await screen.findByText('Email');

    await user.selectOptions(screen.getByLabelText('Group by'), 'ci');
    expect(await screen.findByText('mail-01')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Configuration item/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Period'), '365d');
    expect(await screen.findByText('Per month')).toBeInTheDocument();
  });
});

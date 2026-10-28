import { beforeAll, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { SlaDashboardPage } from './SlaDashboardPage';

// Each step waits on a mock request, which can pass a second on a busy machine.
beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));

describe('SlaDashboardPage', () => {
  it('shows the totals and the breakdowns', async () => {
    renderWithProviders(<SlaDashboardPage />, { route: '/sla' });

    const breached = await screen.findByRole('button', { name: /^Breached\s*1/ });
    expect(breached).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /^Within target\s*2/ })).toBeInTheDocument();

    const teams = screen.getByRole('table', { name: 'By team' });
    expect(within(teams).getByRole('button', { name: 'Service desk' })).toBeInTheDocument();
    expect(within(teams).getByRole('button', { name: 'No team' })).toBeInTheDocument();
    const priorities = screen.getByRole('table', { name: 'By priority' });
    expect(within(priorities).getByRole('button', { name: 'Critical' })).toBeInTheDocument();
    const customers = screen.getByRole('table', { name: 'By customer' });
    expect(within(customers).getByRole('button', { name: 'Globex' })).toBeInTheDocument();
    // No drill-down until something is picked.
    expect(screen.queryByRole('button', { name: /Clear/ })).not.toBeInTheDocument();
  });

  it('drills down from a state tile and from a breakdown count', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SlaDashboardPage />, { route: '/sla' });

    await user.click(await screen.findByRole('button', { name: /^At risk\s*1/ }));
    expect(await screen.findByRole('link', { name: 'I-000042' })).toHaveAttribute('href', '/incidents/42');
    expect(screen.getByText('VPN drops every hour')).toBeInTheDocument();
    expect(screen.getByText('81% used')).toBeInTheDocument();

    const teams = screen.getByRole('table', { name: 'By team' });
    await user.click(within(teams).getByRole('button', { name: 'Service desk: 1 breached' }));
    expect(await screen.findByText('Breached · Team: Service desk')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'I-000041' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'I-000042' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Clear/ }));
    expect(screen.queryByRole('link', { name: 'I-000041' })).not.toBeInTheDocument();
  });

  it('opens a drill-down from the URL, and requests on the record screen', async () => {
    renderWithProviders(<SlaDashboardPage />, { route: '/sla?type=request&org=4' });
    expect(await screen.findByText('Customer: Globex')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'R-000044' })).toHaveAttribute('href', '/records/UserRequest/44');
    expect(screen.getByText('Paused at 35%')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'I-000041' })).not.toBeInTheDocument();
  });
});

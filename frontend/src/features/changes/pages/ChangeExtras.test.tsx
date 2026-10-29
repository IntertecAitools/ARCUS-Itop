import { beforeAll, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { RiskCard } from '../components/RiskCard';
import { PirCard } from '../components/PirCard';
import { ChangeBlackoutsPage } from './ChangeBlackoutsPage';
import { ChangeCalendarPage } from './ChangeCalendarPage';
import { PirQueuePage } from './PirQueuePage';
import { addDays, dayParam } from '../lib/calendar';

beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));

describe('ChangeCalendarPage', () => {
  const tomorrow = dayParam(addDays(new Date(), 1));

  it('shows the day with its clashing changes, each linked to its record', async () => {
    renderWithProviders(<ChangeCalendarPage />, { route: `/change-calendar?view=day&date=${tomorrow}` });
    expect(await screen.findByText('2 changes')).toBeInTheDocument();
    expect(screen.getByText(/Clashes with C-000013 on CI mail-relay-01/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'C-000012' })).toHaveAttribute('href', '/records/NormalChange/12');
  });

  it('filters by team', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangeCalendarPage />, { route: `/change-calendar?view=day&date=${tomorrow}` });
    await screen.findByText('2 changes');
    await user.selectOptions(screen.getByLabelText('All teams'), '8');
    expect(await screen.findByText('No change is planned on this day.')).toBeInTheDocument();
  });

  it('lists clashes under Needs attention in the month view', async () => {
    renderWithProviders(<ChangeCalendarPage />, { route: `/change-calendar?date=${tomorrow}` });
    expect(await screen.findByText(/2 changes with a clash or in a blackout window/)).toBeInTheDocument();
  });
});

describe('RiskCard', () => {
  it('scores the answers and shows the level', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RiskCard id="701" />);
    const form = await screen.findByRole('form', { name: 'Risk questionnaire' });
    const save = within(form).getByRole('button', { name: 'Save assessment' });
    expect(save).toBeDisabled();
    await user.click(within(form).getByLabelText('The whole business'));
    await user.click(within(form).getByLabelText('Not possible'));
    await user.click(within(form).getByLabelText('Full test'));
    await user.click(save);
    // 3×10 + 3×10 + 2×0 of 80
    expect(await screen.findByText('High risk · 75')).toBeInTheDocument();
    expect(screen.getByText(/the CAB weighs it/)).toBeInTheDocument();
  });

  it('forbids the pre-approved path for a high-risk routine change', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RiskCard id="77" />);
    const form = await screen.findByRole('form', { name: 'Risk questionnaire' });
    await user.click(within(form).getByLabelText('The whole business'));
    await user.click(within(form).getByLabelText('Not possible'));
    await user.click(within(form).getByRole('button', { name: 'Save assessment' }));
    expect(await screen.findByText(/cannot go ahead as pre-approved/)).toBeInTheDocument();
  });
});

describe('post-implementation review', () => {
  it('waits until the change is implemented', async () => {
    renderWithProviders(<PirCard id="702" />);
    expect(await screen.findByText('Written once the change is implemented.')).toBeInTheDocument();
  });

  it('is listed as due, then written and shown', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PirQueuePage />);
    expect(await screen.findByRole('link', { name: 'C-000014' })).toHaveAttribute('href', '/records/EmergencyChange/14');

    renderWithProviders(<PirCard id="14" />);
    const form = await screen.findByRole('form', { name: 'Post-implementation review' });
    await user.click(within(form).getByLabelText('Rolled back'));
    const save = within(form).getByRole('button', { name: 'Save review' });
    expect(save).toBeDisabled();
    await user.type(within(form).getByLabelText(/What didn’t/), 'The patch broke VPN logins');
    await user.type(within(form).getByLabelText('Incidents caused'), 'I-000201');
    await user.type(within(form).getByLabelText('Action'), 'Test VPN in staging first');
    await user.click(save);
    expect(await screen.findByText('Rolled back')).toBeInTheDocument();
    expect(screen.getByText(/I-000201/)).toBeInTheDocument();
    expect(screen.getByText(/Test VPN in staging first/)).toBeInTheDocument();
  });
});

describe('ChangeBlackoutsPage', () => {
  it('adds a blackout window', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangeBlackoutsPage />);
    expect(await screen.findByText('Year-end freeze')).toBeInTheDocument();
    const form = screen.getByRole('form', { name: 'New blackout window' });
    await user.type(within(form).getByLabelText('Name'), 'Migration weekend');
    await user.type(within(form).getByLabelText('Starts'), '2026-11-14T00:00');
    await user.type(within(form).getByLabelText('Ends'), '2026-11-16T00:00');
    await user.click(within(form).getByRole('button', { name: 'Add window' }));
    expect(await screen.findByText('Migration weekend')).toBeInTheDocument();
  });
});

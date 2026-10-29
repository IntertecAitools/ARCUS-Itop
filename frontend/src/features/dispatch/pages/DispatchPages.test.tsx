import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { resetDispatchMock } from '@/mocks/handlers/dispatch';
import { AssignmentRulesPage } from './AssignmentRulesPage';
import { TeamQueuePage } from './TeamQueuePage';

beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));
beforeEach(() => resetDispatchMock());

describe('TeamQueuePage', () => {
  it('lists what waits for the team, each linked to its own screen', async () => {
    renderWithProviders(<TeamQueuePage />);
    expect(await screen.findByRole('link', { name: 'I-000042' })).toHaveAttribute('href', '/incidents/42');
    expect(screen.getByRole('link', { name: 'R-000043' })).toHaveAttribute('href', '/records/UserRequest/43');
    expect(screen.getByText('Response overdue')).toBeInTheDocument();
    expect(screen.getByText(/Tickets sent to Network/)).toBeInTheDocument();
  });

  it('Take it takes the ticket out of the queue', async () => {
    const user = userEvent.setup();
    renderWithProviders(<TeamQueuePage />);
    const row = (await screen.findByRole('link', { name: 'I-000042' })).closest('tr')!;
    await user.click(within(row).getByRole('button', { name: 'Take it' }));
    expect(await screen.findByText('1 waiting')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'I-000042' })).not.toBeInTheDocument();
  });
});

describe('AssignmentRulesPage', () => {
  it('adds a rule, saves it, and tries a ticket against it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<AssignmentRulesPage />);

    expect(await screen.findByText(/No rules yet/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Add a rule' }));
    const save = screen.getByRole('button', { name: 'Save rules' });
    // A name and a team are needed first.
    expect(save).toBeDisabled();

    await user.type(screen.getByLabelText('Rule 1: name'), 'VPN to network');
    await user.selectOptions(screen.getByLabelText('Rule 1: category'), 'incident');
    await user.selectOptions(await screen.findByLabelText('Rule 1: service'), '3');
    await user.selectOptions(screen.getByLabelText('Rule 1: subcategory'), '31');
    await user.selectOptions(screen.getByLabelText('Rule 1: team'), '7');
    await user.click(screen.getByLabelText(/Email the team/));
    await user.click(save);
    expect(await screen.findByText(/Rules saved/)).toBeInTheDocument();
    expect(screen.getByText(/Last changed by admin/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Where would it go?' }));
    expect(await screen.findByText('No rule matches: it stays New for the service desk.')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Try: service'), '3');
    await user.selectOptions(screen.getByLabelText('Try: subcategory'), '31');
    await user.click(screen.getByRole('button', { name: 'Where would it go?' }));
    expect(await screen.findByText('“VPN to network” sends it to Network.')).toBeInTheDocument();
  });
});

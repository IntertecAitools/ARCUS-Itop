import { beforeAll, describe, expect, it } from 'vitest';
import userEvent from '@testing-library/user-event';
import { configure, renderWithProviders, screen, within } from '@/test/render';
import { ChangeGovernancePanel } from './ChangeGovernancePanel';

// The mock store lives for the whole file, so each test uses its own change.

beforeAll(() => configure({ asyncUtilTimeout: 10_000 }));

describe('ChangeGovernancePanel', () => {
  it('shows what a normal change still needs, and saves the plans', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangeGovernancePanel id="601" />);

    expect(await screen.findByText(/Still missing: implementation plan, rollback plan, test plan/)).toBeInTheDocument();
    expect(screen.getAllByText('Required to plan')).toHaveLength(3);

    await user.type(screen.getByLabelText('Implementation plan'), 'Drain, patch, restart');
    await user.type(screen.getByLabelText('Rollback plan'), 'Restore the snapshot');
    await user.click(screen.getByRole('button', { name: 'Save plans' }));

    expect(await screen.findByText('Still missing: test plan.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save plans' })).toBeDisabled();
  });

  it('records a deferral, then an approval with conditions, and keeps the history', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangeGovernancePanel id="602" />);

    const form = await screen.findByRole('form', { name: 'Record the CAB decision' });
    const record = within(form).getByRole('button', { name: 'Record decision' });
    expect(record).toBeDisabled();

    await user.type(within(form).getByLabelText('Attendees'), 'Ann Ops{enter}Bo Sec');
    await user.click(within(form).getByLabelText(/Defer/));
    await user.type(within(form).getByLabelText(/Notes/), 'Need the load test');
    await user.click(record);
    expect(await screen.findByText('Decision recorded: deferred.')).toBeInTheDocument();

    const history = screen.getByRole('list', { name: 'CAB decisions' });
    expect(within(history).getByText('Deferred')).toBeInTheDocument();
    expect(within(history).getByText('Ann Ops, Bo Sec')).toBeInTheDocument();

    // Still waiting: decide again.
    const again = screen.getByRole('form', { name: 'Record the CAB decision' });
    await user.click(within(again).getByLabelText(/Approve/));
    await user.type(within(again).getByLabelText('Conditions'), 'Only after 20:00');
    await user.click(within(again).getByRole('button', { name: 'Record decision' }));

    expect(await screen.findByText('Decision recorded: approved.')).toBeInTheDocument();
    expect(screen.getByText('Approved', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Record the CAB decision' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'CAB decisions' })).getAllByRole('listitem')).toHaveLength(2);
  });

  it('asks why before a rejection can be recorded', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangeGovernancePanel id="603" />);
    const form = await screen.findByRole('form', { name: 'Record the CAB decision' });
    await user.click(within(form).getByLabelText(/Not approve/));
    expect(within(form).getByLabelText('Notes (why it was not approved)')).toBeInTheDocument();
    expect(within(form).getByRole('button', { name: 'Record decision' })).toBeDisabled();
    await user.type(within(form).getByLabelText(/Notes/), 'Clashes with the freeze');
    expect(within(form).getByRole('button', { name: 'Record decision' })).toBeEnabled();
  });

  it('a routine change needs only its implementation plan and never goes to the CAB', async () => {
    renderWithProviders(<ChangeGovernancePanel id="77" />);
    expect(await screen.findByText('Routine changes are pre-approved: they do not go to the CAB.')).toBeInTheDocument();
    expect(screen.getAllByText('Optional')).toHaveLength(2);
    expect(screen.getByText('Still missing: implementation plan.')).toBeInTheDocument();
  });

  it('says when the iTop lacks the extension, and keeps only the rollback plan editable', async () => {
    renderWithProviders(<ChangeGovernancePanel id="999" />);
    expect(await screen.findByText(/installs the arcus-change-cab extension/)).toBeInTheDocument();
    expect(screen.getByLabelText('Implementation plan')).toBeDisabled();
    expect(screen.getByLabelText('Test plan')).toBeDisabled();
    expect(screen.getByLabelText('Rollback plan')).toBeEnabled();
    expect(screen.queryByRole('form', { name: 'Record the CAB decision' })).not.toBeInTheDocument();
  });
});

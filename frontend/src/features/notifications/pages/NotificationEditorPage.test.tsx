import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen } from '@/test/render';
import { NotificationEditorPage } from './NotificationEditorPage';

const save = vi.fn();

/** User Request has a lifecycle; a plain Ticket has no statuses. */
const optionsFor = (recordType: string) => ({
  recordTypes: [
    { name: 'Ticket', label: 'Ticket', ticket: true },
    { name: 'UserRequest', label: 'User Request', ticket: true },
  ],
  states: recordType === 'UserRequest' ? [{ code: 'resolved', label: 'Resolved' }] : [],
  fields: [],
  slaTimers: [],
  slaPercents: [],
  roles: ['caller'],
  tokens: [],
});

vi.mock('../api/notifications.api', () => ({
  useRule: () => ({ data: undefined, isLoading: false, isError: false }),
  useSaveRule: () => ({ mutate: save, isPending: false, error: null }),
  useDeleteRule: () => ({ mutate: vi.fn(), isPending: false, error: null }),
  useRuleOptions: (recordType: string) => ({ data: optionsFor(recordType) }),
}));

vi.mock('@/features/records', () => ({
  useClassInfo: () => ({ data: undefined }),
  ConditionRows: () => null,
  isComplete: () => true,
}));

vi.mock('@/features/users', () => ({ RecordPicker: () => null }));

beforeEach(() => save.mockReset());

const open = () =>
  renderWithProviders(
    <Routes>
      <Route path="/notifications/:id" element={<NotificationEditorPage />} />
    </Routes>,
    { route: '/notifications/new' },
  );

describe('notification rule editor', () => {
  it('switches to an event a status-less record type offers, and saves it without a status', async () => {
    const user = userEvent.setup();
    open();
    // The new rule starts as "User Request enters a status".
    expect(screen.getByLabelText('Status')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('A record of type'), 'Ticket');

    expect(screen.getByLabelText('…that')).toHaveValue('created');
    expect(screen.queryByLabelText('Status')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Name'), 'Ticket received');
    await user.click(screen.getByRole('button', { name: 'Create rule' }));

    expect(screen.queryByText('Choose the status.')).not.toBeInTheDocument();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0]?.[0].event).toMatchObject({ kind: 'created', recordType: 'Ticket' });
    expect(save.mock.calls[0]?.[0].event).not.toHaveProperty('state');
  }, 30_000);

  it('still asks for the status when the event needs one', async () => {
    const user = userEvent.setup();
    open();
    await user.type(screen.getByLabelText('Name'), 'Request resolved');
    await user.click(screen.getByRole('button', { name: 'Create rule' }));
    expect(screen.getByText('Choose the status.')).toBeInTheDocument();
    expect(save).not.toHaveBeenCalled();
  }, 30_000);
});

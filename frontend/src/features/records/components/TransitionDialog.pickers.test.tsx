import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen } from '@/test/render';
import type { ClassInfo, RecordDto } from '../types';
import { TransitionDialog } from './TransitionDialog';

/** One object per request, as react-query returns the same data on every render. */
const answers = new Map<string, unknown>();
const answer = (key: string, value: unknown) => {
  if (!answers.has(key)) answers.set(key, value);
  return answers.get(key);
};

vi.mock('../api/useRecords', () => ({
  useFieldOptions: (
    _className: string,
    attcode: string,
    params: { context?: Record<string, string> },
    enabled: boolean,
  ) => {
    const key = JSON.stringify([attcode, params, enabled]);
    if (!enabled) return answer(key, { data: undefined, isPending: true, isPlaceholderData: false });
    const options =
      attcode === 'team_id'
        ? [
            { id: 4, label: 'Cloud Team' },
            { id: 5, label: 'Network Team' },
          ]
        : params.context?.team_id === '5'
          ? [{ id: 2, label: 'Nia Network' }]
          : [{ id: 1, label: 'Cleo Cloud' }];
    return answer(key, { data: { options, total: options.length, truncated: false }, isPending: false, isPlaceholderData: false });
  },
}));

const info = {
  name: 'Incident',
  writable: ['team_id', 'agent_id'],
  fields: {
    team_id: { type: 'ExternalKey', ui: 'picker', target: 'Team' },
    agent_id: { type: 'ExternalKey', ui: 'picker', target: 'Person', narrowedBy: ['team_id'] },
  },
  labels: { class: 'Incident', fields: { team_id: 'Team', agent_id: 'Agent' }, values: {}, stimuli: { ev_assign: 'Assign' } },
} as unknown as ClassInfo;

const onApply = vi.fn();

const open = (fields: Record<string, unknown>, prompts = ['team_id', 'agent_id']) =>
  renderWithProviders(
    <TransitionDialog
      info={info}
      record={{ class: 'Incident', id: 1, label: 'I-1', fields } as RecordDto}
      action="ev_assign"
      prompts={prompts}
      required={new Set(prompts)}
      pending={false}
      onApply={onApply}
      onClose={() => undefined}
    />,
  );

const team = () => screen.getByRole('combobox', { name: /Team/ });
const agent = () => screen.getByRole('combobox', { name: /Agent/ });

async function pick(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, label: string) {
  await user.click(field);
  await user.click(await screen.findByRole('option', { name: label }));
}

beforeEach(() => onApply.mockClear());

describe('assign dialog', () => {
  it('lists only the chosen team\'s people, and clears the agent when the team changes', async () => {
    const user = userEvent.setup();
    open({});

    expect(agent()).toBeDisabled();
    expect(agent()).toHaveAttribute('placeholder', 'Choose Team first');

    await pick(user, team(), 'Cloud Team');
    await user.click(agent());
    expect(screen.getByRole('option', { name: 'Cleo Cloud' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Nia Network' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Cleo Cloud' }));
    expect(agent()).toHaveValue('Cleo Cloud');

    await pick(user, team(), 'Network Team');
    expect(agent()).toHaveValue('');
    await user.click(agent());
    expect(screen.getByRole('option', { name: 'Nia Network' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cleo Cloud' })).not.toBeInTheDocument();
  }, 30_000);

  it("uses the record's team when the action doesn't ask for one", async () => {
    const user = userEvent.setup();
    open({ team_id: '5' }, ['agent_id']);

    expect(agent()).toBeEnabled();
    await user.click(agent());
    expect(screen.getByRole('option', { name: 'Nia Network' })).toBeInTheDocument();
  }, 30_000);

  it('does not lock the agent for a team this action cannot set', () => {
    open({}, ['agent_id']);
    expect(agent()).toBeEnabled();
  }, 30_000);
});

import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import type { ClassInfo } from '../types';
import { RecordForm } from './RecordForm';

const optionCalls = vi.fn();

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
    params: { q?: string; context?: Record<string, string> },
    enabled: boolean,
  ) => {
    optionCalls(attcode, params, enabled);
    const key = JSON.stringify([attcode, params]);
    if (attcode === 'org_id') {
      const data = params.q
        ? { options: [{ id: 900, label: 'Virgin Mobiles' }], total: 1, truncated: false }
        : {
            options: [
              { id: 12, label: 'Acme' },
              { id: 13, label: 'Beta' },
            ],
            total: 1314,
            truncated: true,
          };
      return answer(key, { data, isPending: false, isPlaceholderData: false });
    }
    if (!enabled) return answer(key, { data: undefined, isPending: true, isPlaceholderData: false });
    const people = params.context?.org_id === '13' ? [{ id: 2, label: 'Bea Beta' }] : [{ id: 1, label: 'Al Acme' }];
    return answer(key, {
      data: { options: people, total: 1, truncated: false },
      isPending: false,
      isPlaceholderData: false,
    });
  },
}));

const info = {
  name: 'Incident',
  writable: ['org_id', 'caller_id'],
  fields: {
    org_id: { type: 'ExternalKey', ui: 'picker', target: 'Organization' },
    caller_id: {
      type: 'ExternalKey',
      ui: 'picker',
      target: 'Person',
      narrowedBy: ['org_id'],
    },
  },
  labels: { class: 'Incident', fields: { org_id: 'Organization', caller_id: 'Caller' }, values: {} },
} as unknown as ClassInfo;

const FIELDSETS = [{ id: 'main', label: 'Main', fields: ['org_id', 'caller_id'] }];

function Form() {
  const [draft, setDraft] = useState<Record<string, string>>({});
  return (
    <>
      <RecordForm
        info={info}
        fieldsets={FIELDSETS}
        editing
        draft={draft}
        onChange={(attcode, value) => setDraft((d) => ({ ...d, [attcode]: value }))}
      />
      <output data-testid="draft">{JSON.stringify(draft)}</output>
    </>
  );
}

const org = () => screen.getByRole('combobox', { name: 'Organization' });
const caller = () => screen.getByRole('combobox', { name: 'Caller' });
const draft = () => JSON.parse(screen.getByTestId('draft').textContent ?? '{}') as Record<string, string>;

/** Opens a field's suggestions and clicks one. */
async function pick(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, label: string) {
  await user.click(field);
  await user.click(await screen.findByRole('option', { name: label }));
}

beforeEach(() => optionCalls.mockClear());

describe('record form pickers', () => {
  it('suggests only what matches as you type', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form />);

    await user.click(org());
    expect(screen.getByRole('option', { name: 'Acme' })).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 of 1,314/)).toBeInTheDocument();

    await user.type(org(), 'virg');

    await screen.findByRole('option', { name: 'Virgin Mobiles' });
    expect(screen.queryByRole('option', { name: 'Acme' })).not.toBeInTheDocument();
    expect(optionCalls).toHaveBeenCalledWith('org_id', { q: 'virg', context: {} }, true);

    await user.click(screen.getByRole('option', { name: 'Virgin Mobiles' }));

    expect(draft().org_id).toBe('900');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(org()).toHaveValue('Virgin Mobiles');
  }, 30_000);

  it('picks with the keyboard, without submitting the form', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form />);

    await user.click(org());
    await user.keyboard('{ArrowDown}{Enter}');

    expect(draft().org_id).toBe('13');
    expect(org()).toHaveValue('Beta');
  }, 30_000);

  it('keeps the choice when you leave the field without picking', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form />);

    await pick(user, org(), 'Acme');
    await user.type(org(), 'zzz');
    await user.tab();

    expect(draft().org_id).toBe('12');
    expect(org()).toHaveValue('Acme');
  }, 30_000);

  it('holds the caller back until an organization is chosen, then lists only its people', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form />);

    expect(caller()).toBeDisabled();
    expect(caller()).toHaveAttribute('placeholder', 'Choose Organization first');

    await pick(user, org(), 'Acme');

    expect(caller()).toBeEnabled();
    expect(optionCalls).toHaveBeenCalledWith('caller_id', { context: { org_id: '12' } }, true);
    await user.click(caller());
    const list = screen.getByRole('listbox');
    expect(within(list).getByRole('option', { name: 'Al Acme' })).toBeInTheDocument();
    expect(within(list).queryByRole('option', { name: 'Bea Beta' })).not.toBeInTheDocument();
  }, 30_000);

  it('clears the caller when the organization changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form />);

    await pick(user, org(), 'Acme');
    await pick(user, caller(), 'Al Acme');
    expect(draft().caller_id).toBe('1');

    await pick(user, org(), 'Beta');

    await waitFor(() => expect(draft().caller_id).toBe(''));
    expect(caller()).toHaveValue('');
    await user.click(caller());
    expect(screen.getByRole('option', { name: 'Bea Beta' })).toBeInTheDocument();
  }, 30_000);

  it('can be cleared', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form />);

    await pick(user, org(), 'Acme');
    await user.click(screen.getByRole('button', { name: 'Clear Org' }));

    expect(draft().org_id).toBe('');
    expect(org()).toHaveValue('');
  }, 30_000);
});

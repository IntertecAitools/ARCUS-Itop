import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { renderWithProviders, screen, waitFor } from '@/test/render';
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
        ? { options: [{ id: 900, label: 'Zenith Bank' }], total: 1, truncated: false }
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
    const people =
      params.context?.org_id === '13'
        ? [{ id: 2, label: 'Bea Beta' }]
        : [{ id: 1, label: 'Al Acme' }];
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
      dependsOn: ['org_id'],
      filter: 'SELECT Person WHERE org_id = :this->org_id',
    },
  },
  labels: { class: 'Incident', fields: { org_id: 'Organization', caller_id: 'Caller' }, values: {} },
} as unknown as ClassInfo;

const FIELDSETS = [{ id: 'main', label: 'Main', fields: ['org_id', 'caller_id'] }];

function Form() {
  const [draft, setDraft] = useState<Record<string, string>>({});
  return (
    <RecordForm
      info={info}
      fieldsets={FIELDSETS}
      editing
      draft={draft}
      onChange={(attcode, value) => setDraft((d) => ({ ...d, [attcode]: value }))}
    />
  );
}

const select = (id: string) => document.getElementById(id) as HTMLSelectElement;

beforeEach(() => optionCalls.mockClear());

describe('record form pickers', () => {
  it('holds the caller back until an organization is chosen, then lists only its people', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form />);

    expect(select('field-caller_id')).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Choose Organization first' })).toBeInTheDocument();

    await user.selectOptions(select('field-org_id'), '12');

    expect(select('field-caller_id')).toBeEnabled();
    expect(optionCalls).toHaveBeenCalledWith('caller_id', { context: { org_id: '12' } }, true);
    expect(screen.getByRole('option', { name: 'Al Acme' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Bea Beta' })).not.toBeInTheDocument();
  }, 30_000);

  it('clears the caller when the organization changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form />);

    await user.selectOptions(select('field-org_id'), '12');
    await user.selectOptions(select('field-caller_id'), '1');
    expect(select('field-caller_id')).toHaveValue('1');

    await user.selectOptions(select('field-org_id'), '13');

    expect(select('field-caller_id')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Bea Beta' })).toBeInTheDocument();
  }, 30_000);

  it('offers a search for a list too long to load, and keeps a choice it found', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Form />);

    expect(screen.getByText(/Showing 2 of 1,314/)).toBeInTheDocument();
    await user.type(screen.getByRole('searchbox', { name: 'Search Org' }), 'zen');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Zenith Bank' })).toBeInTheDocument());

    await user.selectOptions(select('field-org_id'), '900');
    expect(select('field-org_id')).toHaveValue('900');

    await user.clear(screen.getByRole('searchbox', { name: 'Search Org' }));
    await waitFor(() => expect(screen.getByRole('option', { name: 'Acme' })).toBeInTheDocument());
    expect(select('field-org_id')).toHaveValue('900');
    expect(screen.getByRole('option', { name: 'Zenith Bank' })).toBeInTheDocument();
  }, 30_000);
});

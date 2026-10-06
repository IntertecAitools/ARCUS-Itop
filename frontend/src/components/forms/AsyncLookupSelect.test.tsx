import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { LookupOption } from '@/types';
import { AsyncLookupSelect } from './AsyncLookupSelect';

const OPTIONS: LookupOption[] = [
  { id: '1', label: 'Demo Corp' },
  { id: '2', label: 'Northwind Retail' },
  { id: '3', label: 'Contoso Health' },
];

function Harness({ onSearch = vi.fn() }: { onSearch?: (q: string) => void }) {
  const [value, setValue] = useState<LookupOption | null>(null);
  return (
    <>
      <label htmlFor="org">Organization</label>
      <AsyncLookupSelect id="org" value={value} onChange={setValue} options={OPTIONS} onSearch={onSearch} excludeIds={['3']} />
      <output>{value?.label ?? 'none'}</output>
    </>
  );
}

describe('AsyncLookupSelect', () => {
  it('opens on focus, filters excluded ids and selects with the keyboard', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<Harness onSearch={onSearch} />);

    const input = screen.getByRole('combobox', { name: 'Organization' });
    await user.click(input);
    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(onSearch).toHaveBeenCalledWith('');

    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.getByText('Northwind Retail', { selector: 'output' })).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(input).toHaveValue('Northwind Retail');
  });

  it('reports typed text and can be cleared', async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<Harness onSearch={onSearch} />);
    const input = screen.getByRole('combobox', { name: 'Organization' });
    await user.type(input, 'demo');
    expect(onSearch).toHaveBeenLastCalledWith('demo');
    await user.click(screen.getByRole('option', { name: 'Demo Corp' }));
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText('none', { selector: 'output' })).toBeInTheDocument();
  });
});

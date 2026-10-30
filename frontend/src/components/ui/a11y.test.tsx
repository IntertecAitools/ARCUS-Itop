import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import axe from 'axe-core';
import { Search } from 'lucide-react';
import { DataTable, type Column } from '@/components/data-display/DataTable';
import { IconButton } from './IconButton';
import { Tabs } from './Tabs';

/**
 * Accessibility of the shared building blocks, with axe-core in jsdom. Colour
 * contrast is left to the Playwright journey (tests/journeys/a11y.spec.ts):
 * jsdom does not paint, so axe cannot measure it here.
 */
async function violations(container: HTMLElement) {
  const results = await axe.run(container, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

describe('IconButton', () => {
  it('is named by its label, with the glyph hidden from screen readers', async () => {
    const { container } = render(<IconButton label="Search" icon={<Search />} />);
    const button = screen.getByRole('button', { name: 'Search' });
    expect(button.querySelector('svg')?.closest('[aria-hidden]')).not.toBeNull();
    expect(await violations(container)).toEqual([]);
  });
});

function TabsHarness() {
  const [value, setValue] = useState('one');
  return (
    <Tabs
      label="Views"
      value={value}
      onChange={setValue}
      items={[
        { id: 'one', label: 'One' },
        { id: 'two', label: 'Two', count: 3 },
        { id: 'three', label: 'Three' },
      ]}
    />
  );
}

describe('Tabs', () => {
  it('has one tab stop, and the arrow keys, Home and End move and select', async () => {
    const user = userEvent.setup();
    const { container } = render(<TabsHarness />);
    expect(await violations(container)).toEqual([]);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1]);

    await user.tab();
    expect(tabs[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{End}');
    expect(tabs[2]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(tabs[0]).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Home}');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });
});

describe('DataTable', () => {
  type Row = { id: number; title: string };
  const columns: Column<Row>[] = [{ id: 'title', header: 'Title', cell: ({ row }) => row.original.title }];

  it('makes a clickable row reachable and openable from the keyboard', async () => {
    const user = userEvent.setup();
    const open = vi.fn();
    const { container } = render(
      <DataTable data={[{ id: 1, title: 'First' }, { id: 2, title: 'Second' }]} columns={columns} onRowClick={open} />,
    );
    expect(await violations(container)).toEqual([]);

    await user.tab();
    expect(screen.getByRole('row', { name: /First/ })).toHaveFocus();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(open).toHaveBeenCalledWith({ id: 2, title: 'Second' });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen } from '@/test/render';
import type { DashletData } from '../api/useDashboard';
import { Dashlet } from './Dashlet';

let data: DashletData;
vi.mock('../api/useDashboard', () => ({
  useDashletData: () => ({ data, isLoading: false, isError: false, error: null }),
}));

const table = { id: '1', kind: 'table' as const, title: 'By agent', class: 'Incident' };

describe('Dashlet grouped counts', () => {
  it('says when the groups cover only part of the matches', () => {
    data = {
      kind: 'table',
      class: 'Incident',
      total: 18000,
      truncated: true,
      groups: [
        { key: '1', label: 'Ana Rossi', count: 3000 },
        { key: '2', label: 'Leo Kim', count: 2000 },
      ],
    };
    renderWithProviders(<Dashlet dashboardId="d" dashlet={table} />);
    expect(screen.getByText(/Grouped from the first 5,000 of 18,000 records/)).toBeInTheDocument();
  });

  it('adds nothing when every match was counted', () => {
    data = { kind: 'table', class: 'Incident', total: 5, groups: [{ key: '1', label: 'Ana Rossi', count: 5 }] };
    renderWithProviders(<Dashlet dashboardId="d" dashlet={table} />);
    expect(screen.queryByText(/Grouped from the first/)).not.toBeInTheDocument();
  });
});

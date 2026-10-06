import { render, screen } from '@testing-library/react';
import { Bug } from 'lucide-react';
import { describe, expect, it } from 'vitest';
import { KpiCard } from './KpiCard';

describe('KpiCard', () => {
  it('renders value and a green trend when the change is good', () => {
    render(<KpiCard label="Open Problems" value={42} icon={Bug} trend={{ value: -12, goodWhen: 'down' }} trendCaption="vs last week" />);
    expect(screen.getByText('42')).toBeInTheDocument();
    const trend = screen.getByText(/-12%/);
    expect(trend).toHaveTextContent('↓ -12%');
    expect(trend).toHaveClass('text-success');
  });

  it('renders a red trend when the change is bad', () => {
    render(<KpiCard label="Unassigned" value={5} icon={Bug} trend={{ value: 25, goodWhen: 'down' }} />);
    expect(screen.getByText(/\+25%/)).toHaveClass('text-danger');
  });

  it('hides the value while loading', () => {
    render(<KpiCard label="Known Errors" value={7} icon={Bug} loading />);
    expect(screen.queryByText('7')).not.toBeInTheDocument();
  });
});

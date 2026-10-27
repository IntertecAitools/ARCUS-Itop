import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { dayLabel, PendingNote } from './PendingNote';

describe('PendingNote', () => {
  it('shows when to act and why', () => {
    render(<PendingNote pending={{ reason: 'Waiting for the vendor', nextActionDate: '2026-10-30', overdue: false }} />);
    expect(screen.getByText(`Act by ${dayLabel('2026-10-30')}`)).toBeInTheDocument();
    expect(screen.getByText('Waiting for the vendor')).toBeInTheDocument();
  });

  it('says overdue in words, not only in colour', () => {
    const { container } = render(
      <PendingNote pending={{ reason: 'Caller away', nextActionDate: '2026-10-01', overdue: true }} compact />,
    );
    expect(screen.getByText(/Overdue since/)).toBeInTheDocument();
    expect(container.querySelector('[data-overdue]')).toHaveAttribute('title', 'On hold: Caller away');
  });

  it('keeps the calendar day whatever the time zone', () => {
    expect(dayLabel('2026-01-01')).toMatch(/2026/);
    expect(dayLabel('2026-12-31')).toMatch(/31/);
  });
});

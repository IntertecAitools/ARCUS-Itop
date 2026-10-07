import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '@/types/ticket';
import { StatusPill } from './StatusPill';
import { PriorityBadge } from './PriorityBadge';

describe('StatusPill', () => {
  it('renders a readable label for every status in the vocabulary', () => {
    // A status added to the type but not to the map would render blank —
    // this catches that at test time rather than in a customer's queue.
    for (const status of TICKET_STATUSES) {
      const { unmount } = render(<StatusPill status={status} />);
      expect(screen.getByText(/\w/)).toBeInTheDocument();
      unmount();
    }
  });

  it('states the status in text, not by colour alone', () => {
    render(<StatusPill status="in_progress" />);
    expect(screen.getByText('In Progress')).toBeInTheDocument();
  });
});

describe('PriorityBadge', () => {
  it('renders a label for every priority', () => {
    for (const priority of TICKET_PRIORITIES) {
      const { unmount } = render(<PriorityBadge priority={priority} />);
      expect(screen.getByText(/\w/)).toBeInTheDocument();
      unmount();
    }
  });
});

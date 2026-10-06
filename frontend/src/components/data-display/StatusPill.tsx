import { Badge, type BadgeTone } from '@/components/ui';
import type { TicketStatus } from '@/types/ticket';

/**
 * Status → tone + label in ONE place. Every screen that shows a ticket status
 * uses this component, so a status can never read "In progress" on one screen
 * and "Working" on another.
 *
 * `dot` is on by default: the colour is reinforced by a shape and the label, so
 * the pill survives greyscale printing and colour-blind readers.
 */
const statusMeta: Record<TicketStatus, { tone: BadgeTone; label: string }> = {
  new: { tone: 'brand', label: 'New' },
  open: { tone: 'info', label: 'Open' },
  in_progress: { tone: 'info', label: 'In Progress' },
  pending: { tone: 'warning', label: 'Pending' },
  resolved: { tone: 'good', label: 'Resolved' },
  closed: { tone: 'neutral', label: 'Closed' },
};

export function StatusPill({
  status,
  size = 'md',
}: {
  status: TicketStatus;
  size?: 'sm' | 'md';
}) {
  const meta = statusMeta[status];
  return (
    <Badge tone={meta.tone} dot size={size}>
      {meta.label}
    </Badge>
  );
}

export function statusLabel(status: TicketStatus) {
  return statusMeta[status].label;
}

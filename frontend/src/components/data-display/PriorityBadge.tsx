import { Badge, type BadgeTone } from '@/components/ui';
import type { TicketPriority } from '@/types/ticket';

/**
 * Priority uses the RESERVED status roles (critical / serious / warning / good).
 * Those four roles are never reused as a chart series colour, so a red mark in
 * a chart can never be mistaken for "critical priority".
 */
const priorityMeta: Record<TicketPriority, { tone: BadgeTone; label: string }> = {
  critical: { tone: 'critical', label: 'Critical' },
  high: { tone: 'serious', label: 'High' },
  medium: { tone: 'warning', label: 'Medium' },
  low: { tone: 'good', label: 'Low' },
};

export function PriorityBadge({
  priority,
  size = 'md',
}: {
  priority: TicketPriority;
  size?: 'sm' | 'md';
}) {
  const meta = priorityMeta[priority];
  return (
    <Badge tone={meta.tone} dot size={size}>
      {meta.label}
    </Badge>
  );
}

export function priorityLabel(priority: TicketPriority) {
  return priorityMeta[priority].label;
}

import { Badge, type BadgeTone } from '@/components/ui';
import type { OperationalStatus } from '@/features/incidents/types';

/**
 * Operational Status → tone + label in ONE place.
 */
const statusMeta: Record<OperationalStatus, { tone: BadgeTone; label: string }> = {
  operational: { tone: 'good', label: 'Operational' },
  degraded: { tone: 'warning', label: 'Degraded' },
  outage: { tone: 'critical', label: 'Outage' },
};

export function OperationalStatusPill({
  status,
  size = 'md',
}: {
  status: OperationalStatus;
  size?: 'sm' | 'md';
}) {
  const meta = statusMeta[status];
  return (
    <Badge tone={meta.tone} dot size={size}>
      {meta.label}
    </Badge>
  );
}

export function operationalStatusLabel(status: OperationalStatus) {
  return statusMeta[status].label;
}
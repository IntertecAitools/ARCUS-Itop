import { Badge, type BadgeTone } from '@/components/ui';
import type { Column } from '@/components/data-display';
import { shortDateTime } from '@/lib/utils';
import type { DashboardChange } from '../types';

/**
 * A tone per Change status code, for the dot only: the words are iTop's own
 * label, sent by the BFF, so a renamed or added status still reads right.
 */
const TONE: Record<string, BadgeTone> = {
  new: 'info',
  assigned: 'info',
  validated: 'brand',
  approved: 'good',
  plannedscheduled: 'brand',
  implemented: 'good',
  monitored: 'good',
  notapproved: 'critical',
  rejected: 'critical',
};

/** Columns for the My Assignments "Changes" tab. */
export function changeColumns(): Column<DashboardChange>[] {
  return [
    {
      accessorKey: 'ref',
      header: 'ID',
      size: 76,
      cell: ({ row }) => <span className="font-medium whitespace-nowrap text-ink">{row.original.ref}</span>,
    },
    {
      accessorKey: 'title',
      header: 'Summary',
      cell: ({ row }) => (
        <span className="block truncate text-ink" title={row.original.title}>
          {row.original.title}
        </span>
      ),
    },
    {
      accessorKey: 'statusLabel',
      header: 'Status',
      size: 150,
      enableSorting: false,
      cell: ({ row }) => (
        <Badge tone={TONE[row.original.status] ?? 'neutral'} dot>
          {row.original.statusLabel}
        </Badge>
      ),
    },
    {
      accessorKey: 'startDate',
      header: 'Planned start',
      size: 120,
      cell: ({ row }) =>
        row.original.startDate ? (
          <span className="whitespace-nowrap text-ink-muted">{shortDateTime(row.original.startDate)}</span>
        ) : (
          <span className="text-ink-muted">Not planned</span>
        ),
    },
  ];
}

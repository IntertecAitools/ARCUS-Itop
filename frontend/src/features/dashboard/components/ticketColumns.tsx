import { Link } from 'react-router-dom';
import { MoreVertical } from 'lucide-react';
import { Avatar, IconButton } from '@/components/ui';
import { PriorityBadge, StatusPill, type Column } from '@/components/data-display';
import { isModuleRegistered } from '@/config/modules';
import { shortDateTime } from '@/lib/utils';
import type { DashboardTicket } from '../types';

/**
 * Column recipes shared by the two ticket tables on this page.
 *
 * `withAssignee` is a parameter rather than two near-identical lists, so the ID
 * link, the badges and the timestamp format can never drift between the cards.
 */
export function ticketColumns({
  withAssignee = true,
  withCreated = true,
}: { withAssignee?: boolean; withCreated?: boolean } = {}): Column<DashboardTicket>[] {
  const ticketsLinkable = isModuleRegistered('/incidents');

  const columns: Column<DashboardTicket>[] = [
    {
      accessorKey: 'ref',
      header: 'ID',
      size: 76,
      // Only a link once the incidents module exists; until then the reference
      // is still worth showing, just not clickable.
      cell: ({ row }) =>
        ticketsLinkable ? (
          <Link
            to={`/incidents/${row.original.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium whitespace-nowrap text-brand-ink transition-colors hover:text-brand-hover hover:underline"
          >
            {row.original.ref}
          </Link>
        ) : (
          <span className="font-medium whitespace-nowrap text-ink">{row.original.ref}</span>
        ),
    },
    {
      accessorKey: 'summary',
      header: 'Summary',
      cell: ({ row }) => (
        <span className="block truncate text-ink" title={row.original.summary}>
          {row.original.summary}
        </span>
      ),
    },
    {
      accessorKey: 'priority',
      header: 'Priority',
      size: 92,
      cell: ({ row }) => <PriorityBadge priority={row.original.priority} size="sm" />,
    },
    {
      accessorKey: 'status',
      header: 'Status',
      size: 104,
      enableSorting: false,
      cell: ({ row }) => <StatusPill status={row.original.status} size="sm" />,
    },
  ];

  if (withAssignee) {
    columns.push({
      accessorKey: 'assignee',
      header: 'Assignee',
      size: 108,
      enableSorting: false,
      cell: ({ row }) => {
        const assignee = row.original.assignee;
        if (!assignee) return <span className="text-ink-muted">Unassigned</span>;
        return (
          <span className="flex items-center gap-2">
            <Avatar name={assignee.name} size="xs" />
            <span className="truncate text-ink-secondary">{assignee.name}</span>
          </span>
        );
      },
    });
  }

  if (withCreated) {
    columns.push({
      accessorKey: 'createdAt',
      header: 'Created',
      size: 100,
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-ink-muted">
          {shortDateTime(row.original.createdAt)}
        </span>
      ),
    });
  }

  columns.push({
    id: 'actions',
    header: '',
    size: 36,
    enableSorting: false,
    cell: ({ row }) => (
      <IconButton
        size="sm"
        label={`Actions for ${row.original.ref}`}
        icon={<MoreVertical className="size-4" />}
        onClick={(e) => e.stopPropagation()}
      />
    ),
  });

  return columns;
}

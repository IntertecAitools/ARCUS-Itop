import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LifeBuoy, MoreVertical } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Avatar, Card, IconButton } from '@/components/ui';
import {
  DataTable,
  PriorityBadge,
  StatusPill,
  type Column,
} from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { shortDateTime } from '@/lib/utils';
import { useIncidents } from '../api/useIncidents';
import { useIncidentFilters } from '../hooks/useIncidentFilters';
import { IncidentFilterBar } from '../components/IncidentFilterBar';
import { IncidentPagination } from '../components/IncidentPagination';
import type { Incident } from '../types';

/**
 * The incident queue.
 *
 * Filters, sort and page all live in the URL (see `useIncidentFilters`), so a
 * view is shareable and the back button behaves. The table itself is the shared
 * DataTable, so sorting affordances and row heights match every other list.
 */
export function IncidentListPage() {
  const navigate = useNavigate();
  const { filters, update, clear, activeCount } = useIncidentFilters();
  const { data, isLoading, isError, error } = useIncidents(filters);

  const columns = useMemo<Column<Incident>[]>(
    () => [
      {
        accessorKey: 'ref',
        header: 'ID',
        size: 104,
        cell: ({ row }) => (
          <Link
            to={`/incidents/${row.original.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium whitespace-nowrap text-brand-ink transition-colors hover:text-brand-hover hover:underline"
          >
            {row.original.ref}
          </Link>
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
        size: 112,
        cell: ({ row }) => <PriorityBadge priority={row.original.priority} size="sm" />,
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 124,
        cell: ({ row }) => <StatusPill status={row.original.status} size="sm" />,
      },
      {
        accessorKey: 'assignee',
        header: 'Assignee',
        size: 148,
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
      },
      {
        accessorKey: 'createdAt',
        header: 'Created',
        size: 124,
        cell: ({ row }) => (
          <span className="whitespace-nowrap text-ink-muted">
            {shortDateTime(row.original.createdAt)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        size: 44,
        enableSorting: false,
        cell: ({ row }) => (
          <IconButton
            size="sm"
            label={`Actions for ${row.original.ref}`}
            icon={<MoreVertical className="size-4" />}
            onClick={(e) => e.stopPropagation()}
          />
        ),
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Incidents' }]}
        title="Incidents"
        description={
          data
            ? `${data.total} ${data.total === 1 ? 'incident' : 'incidents'} matching this view.`
            : 'Unplanned interruptions to a service.'
        }
      />

      {isError ? (
        <div
          role="alert"
          className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
        >
          Couldn’t load incidents. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}

      <IncidentFilterBar
        filters={filters}
        onChange={update}
        onClear={clear}
        activeCount={activeCount}
      />

      <Card>
        {!isLoading && data?.items.length === 0 ? (
          <EmptyState
            icon={<LifeBuoy className="size-5" />}
            title={activeCount > 0 ? 'No incidents match these filters' : 'No incidents yet'}
            description={
              activeCount > 0
                ? 'Try widening the filters, or clear them to see the whole queue.'
                : 'Incidents raised in iTop will appear here.'
            }
          />
        ) : (
          <>
            <DataTable
              data={data?.items ?? []}
              columns={columns}
              isLoading={isLoading}
              loadingRows={8}
              onRowClick={(incident) => navigate(`/incidents/${incident.id}`)}
            />
            {data ? (
              <IncidentPagination
                page={data.page}
                pages={data.pages}
                total={data.total}
                limit={data.limit}
                onPage={(page) => update({ page })}
              />
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}

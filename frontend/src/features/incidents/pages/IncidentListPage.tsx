import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LifeBuoy, MoreVertical, Plus, Siren } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Avatar, Badge, buttonClasses, Card, IconButton } from '@/components/ui';
import {
  DataTable,
  PendingNote,
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
          <span className="flex min-w-0 items-center gap-2">
            {row.original.major ? (
              <Badge tone="critical" size="sm" icon={<Siren className="size-3" />}>
                Major
              </Badge>
            ) : null}
            <span className="block truncate text-ink" title={row.original.summary}>
              {row.original.summary}
            </span>
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
        accessorKey: 'operationalStatus',
        header: 'Operational Status',
        size: 160,
        cell: ({ row }) => {
          const status = row.original.operationalStatus;
          if (!status) return <span className="text-ink-muted">—</span>;
          return (
            <span className="text-ink-secondary capitalize">{status}</span>
          );
        },
      },
      {
        accessorKey: 'status',
        header: 'Status',
        size: 150,
        // On hold: the next-action date under the pill, red once it has passed.
        cell: ({ row }) => (
          <span className="flex flex-col items-start gap-1">
            <StatusPill status={row.original.status} size="sm" />
            {row.original.pending ? <PendingNote pending={row.original.pending} compact /> : null}
          </span>
        ),
      },
      {
        accessorKey: 'caller',
        header: 'Caller',
        size: 160,
        cell: ({ row }) => {
          const caller = row.original.caller;
          if (!caller) return <span className="text-ink-muted">—</span>;
          return (
            <span className="truncate text-ink-secondary">{caller.name}</span>
          );
        },
      },
      {
        accessorKey: 'organization',
        header: 'Organisation',
        size: 160,
        cell: ({ row }) => {
          const org = row.original.organization;
          if (!org) return <span className="text-ink-muted">—</span>;
          return (
            <span className="truncate text-ink-secondary">{org.name}</span>
          );
        },
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
        actions={
          <Link to="/incidents/new" className={buttonClasses({ size: 'sm' })}>
            <Plus className="me-1.5 size-4" />
            New incident
          </Link>
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
                : 'Incidents you raise will appear here.'
            }
            action={
              activeCount === 0 ? (
                <Link to="/incidents/new" className={buttonClasses({ size: 'sm' })}>
                  Raise the first one
                </Link>
              ) : undefined
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

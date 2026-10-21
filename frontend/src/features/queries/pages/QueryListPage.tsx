import { Link, useNavigate } from 'react-router-dom';
import { Play, Plus } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { buttonClasses, Card } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-display';
import { useSavedQueries } from '../api/queries.api';
import { describeQuery } from '../lib/queries';
import type { SavedQuery } from '../types';

/** The query phrasebook: saved queries anyone on staff can run. */
export function QueryListPage() {
  const { data, isLoading, isError, error } = useSavedQueries();
  const navigate = useNavigate();

  const columns: Column<SavedQuery>[] = [
    {
      id: 'name',
      header: 'Query',
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate font-medium text-ink" title={row.original.description || undefined}>
            {row.original.name}
          </span>
          {row.original.template ? (
            <span className="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] text-ink-secondary">
              Predefined
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'lists',
      header: 'Lists',
      enableSorting: false,
      size: 180,
      cell: ({ row }) => <span className="block truncate">{row.original.recordTypeLabel || '—'}</span>,
    },
    {
      id: 'defined',
      header: 'Defined by',
      enableSorting: false,
      cell: ({ row }) => <span className="block truncate text-ink-secondary">{describeQuery(row.original)}</span>,
    },
    {
      id: 'owner',
      header: 'Owner',
      enableSorting: false,
      size: 160,
      cell: ({ row }) => <span className="block truncate">{row.original.owner?.name || '—'}</span>,
    },
    {
      id: 'run',
      header: '',
      enableSorting: false,
      size: 90,
      cell: ({ row }) =>
        row.original.runnable ? (
          <Link
            to={`/queries/${row.original.id}/run`}
            onClick={(e) => e.stopPropagation()}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            <Play className="me-1 size-3.5" aria-hidden />
            Run
          </Link>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Queries' }]}
        title="Queries"
        description="Saved searches over any kind of record. Results show only what you are allowed to see."
        actions={
          <Link to="/queries/new" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
            <Plus className="me-1.5 size-4" />
            New query
          </Link>
        }
      />
      {isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {error instanceof Error ? error.message : 'The queries could not be loaded.'}
        </div>
      ) : null}
      <Card>
        <DataTable
          data={data?.queries ?? []}
          columns={columns}
          isLoading={isLoading}
          loadingRows={6}
          // Open what the query is for: its results, or its definition when it cannot run here.
          onRowClick={(q) => navigate(q.runnable ? `/queries/${q.id}/run` : `/queries/${q.id}`)}
        />
      </Card>
    </>
  );
}

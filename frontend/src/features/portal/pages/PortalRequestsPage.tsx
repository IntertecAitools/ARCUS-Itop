import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { buttonClasses, Card, Input } from '@/components/ui';
import { DataTable, StatusPill, type Column } from '@/components/data-display';
import { cn } from '@/lib/utils';
import { useMyRequests } from '../api/portal.api';
import type { PortalTicket } from '../types';

export const formatDate = (value: string) => (value ? value.slice(0, 16) : '—');

const columns: Column<PortalTicket>[] = [
  { id: 'ref', header: 'Reference', size: 110, enableSorting: false, cell: ({ row }) => <span className="font-medium text-brand-ink">{row.original.ref}</span> },
  { id: 'title', header: 'Title', enableSorting: false, cell: ({ row }) => <span className="block truncate text-ink">{row.original.title}</span> },
  { id: 'service', header: 'Service', enableSorting: false, cell: ({ row }) => row.original.subcategory || row.original.service || '—' },
  { id: 'status', header: 'Status', size: 120, enableSorting: false, cell: ({ row }) => <StatusPill status={row.original.status} size="sm" /> },
  { id: 'created', header: 'Raised', size: 140, enableSorting: false, cell: ({ row }) => formatDate(row.original.createdAt) },
];

/** The user's own requests (and incidents), open or closed, newest first. */
export function PortalRequestsPage() {
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const { data, isLoading, isError, error } = useMyRequests(state, page, q.trim());
  const navigate = useNavigate();

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold text-ink">My requests</h1>
        <Link to="/portal/new" className={buttonClasses({ variant: 'primary', size: 'sm' })}>
          <Plus className="mr-1.5 size-4" />
          New request
        </Link>
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex rounded-control border border-line p-0.5" role="tablist" aria-label="Request state">
          {(['open', 'closed'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={state === s}
              onClick={() => {
                setState(s);
                setPage(1);
              }}
              className={cn(
                'rounded-control px-3 py-1 text-[13px]',
                state === s ? 'bg-brand-soft font-medium text-brand-ink' : 'text-ink-secondary hover:text-ink',
              )}
            >
              {s === 'open' ? 'Open' : 'Closed'}
            </button>
          ))}
        </div>
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder="Search by reference or title…"
          aria-label="Search my requests"
          leadingIcon={<Search className="size-4" />}
          className="w-full sm:w-72"
        />
      </div>
      {isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {error instanceof Error ? error.message : 'Your requests could not be loaded.'}
        </div>
      ) : null}
      <Card>
        <DataTable
          data={data?.items ?? []}
          columns={columns}
          isLoading={isLoading}
          loadingRows={5}
          emptyTitle={state === 'open' ? 'No open requests' : 'No closed requests'}
          emptyDescription={state === 'open' ? 'Raise a request and it appears here.' : undefined}
          onRowClick={(t) => navigate(`/portal/requests/${t.id}`)}
        />
        {data && data.pages > 1 ? (
          <div className="flex items-center justify-between border-t border-line px-4 py-3 text-[13px] text-ink-muted">
            <span>
              Page {data.page} of {data.pages}
            </span>
            <div className="flex gap-2">
              <button type="button" disabled={page <= 1} onClick={() => setPage(page - 1)} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                Previous
              </button>
              <button type="button" disabled={page >= data.pages} onClick={() => setPage(page + 1)} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                Next
              </button>
            </div>
          </div>
        ) : null}
      </Card>
    </>
  );
}

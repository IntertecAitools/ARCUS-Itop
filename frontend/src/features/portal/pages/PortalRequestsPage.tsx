import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { buttonClasses, Card, Input } from '@/components/ui';
import { PageIntro } from '@/components/public';
import { DataTable, StatusPill, type Column } from '@/components/data-display';
import { cn, dateTimeText } from '@/lib/utils';
import { useMyRequests } from '../api/portal.api';
import { TargetDate } from '../components/TargetDate';
import type { PortalTicket } from '../types';

/** A request's date-time on the viewer's clock. */
export const formatDate = (value: string) => (value ? dateTimeText(value) : '—');

const columns: Column<PortalTicket>[] = [
  { id: 'ref', header: 'Reference', size: 110, enableSorting: false, cell: ({ row }) => <span className="text-ink-secondary tabular-nums">{row.original.ref}</span> },
  { id: 'title', header: 'Title', enableSorting: false, cell: ({ row }) => <span className="block truncate text-ink">{row.original.title}</span> },
  { id: 'service', header: 'Service', enableSorting: false, cell: ({ row }) => row.original.subcategory || row.original.service || '—' },
  { id: 'status', header: 'Status', size: 120, enableSorting: false, cell: ({ row }) => <StatusPill status={row.original.status} size="sm" /> },
  { id: 'created', header: 'Raised', size: 140, enableSorting: false, cell: ({ row }) => formatDate(row.original.createdAt) },
  { id: 'target', header: 'Expected by', size: 150, enableSorting: false, cell: ({ row }) => <TargetDate ticket={row.original} variant="cell" /> },
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
      <PageIntro
        title="My requests"
        intro="Everything you have raised, with where it stands."
        action={
          <Link to="/portal/new" className={buttonClasses({ variant: 'primary', size: 'lg', className: 'h-11 px-5' })}>
            <Plus className="size-4" aria-hidden />
            New request
          </Link>
        }
      />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line">
        <div className="flex gap-6" role="tablist" aria-label="Request state">
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
                '-mb-px border-b-2 pb-3 text-[15px] transition-colors',
                state === s ? 'border-ink text-ink' : 'border-transparent text-ink-secondary hover:text-ink',
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
          className="mb-3 h-10 w-full sm:w-72"
        />
      </div>
      {isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {error instanceof Error ? error.message : 'Your requests could not be loaded.'}
        </div>
      ) : null}
      {/* Phones: a stacked list; the table needs more width than a phone has. */}
      <ul className="-mt-6 divide-y divide-line border-b border-line sm:hidden" aria-label="My requests">
        {isLoading ? (
          <li className="py-6 text-[14px] text-ink-secondary">Loading…</li>
        ) : !data || data.items.length === 0 ? (
          <li className="py-6 text-[14px] text-ink-secondary">{state === 'open' ? 'No open requests' : 'No closed requests'}</li>
        ) : (
          data.items.map((t) => (
            <li key={t.id}>
              <Link to={`/portal/requests/${t.id}`} className="block py-4 hover:bg-surface-hover">
                <span className="flex items-center justify-between gap-3 text-[13px] text-ink-secondary">
                  <span className="tabular-nums">{t.ref}</span>
                  <span>{formatDate(t.createdAt)}</span>
                </span>
                <span className="mt-1 block text-[16px] text-ink">{t.title}</span>
                <span className="mt-2 flex items-center gap-3">
                  <StatusPill status={t.status} size="sm" />
                  <span className="truncate text-[13px] text-ink-secondary">{t.subcategory || t.service}</span>
                </span>
                {t.targetDate && !t.closed ? (
                  <span className="mt-1 block text-[13px] text-ink-secondary">
                    Expected by <TargetDate ticket={t} variant="cell" />
                  </span>
                ) : null}
              </Link>
            </li>
          ))
        )}
      </ul>
      <Card className="max-sm:border-0 max-sm:bg-transparent">
        <div className="hidden sm:block">
          <DataTable
            data={data?.items ?? []}
            columns={columns}
            isLoading={isLoading}
            loadingRows={5}
            emptyTitle={state === 'open' ? 'No open requests' : 'No closed requests'}
            emptyDescription={state === 'open' ? 'Raise a request and it appears here.' : undefined}
            onRowClick={(t) => navigate(`/portal/requests/${t.id}`)}
          />
        </div>
        {data && data.pages > 1 ? (
          <div className="flex items-center justify-between border-line py-3 text-[13px] text-ink-muted sm:border-t sm:px-4">
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

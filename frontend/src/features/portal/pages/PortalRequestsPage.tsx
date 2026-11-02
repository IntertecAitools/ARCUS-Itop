import { useMemo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { buttonClasses, Card, Input } from '@/components/ui';
import { PageIntro } from '@/components/public';
import { DataTable, DEFAULT_PAGE_SIZE, Pagination, StatusPill, type Column } from '@/components/data-display';
import { cn, dateTimeText } from '@/lib/utils';
import { useMyRequests } from '../api/portal.api';
import { TargetDate } from '../components/TargetDate';
import type { PortalTicket } from '../types';

/** A request's date-time on the viewer's clock. */
export const formatDate = (value: string) => (value ? dateTimeText(value) : '—');

const columns = (t: TFunction): Column<PortalTicket>[] => [
  { id: 'ref', header: t('portal.requests.reference'), size: 110, enableSorting: false, cell: ({ row }) => <span className="text-ink-secondary tabular-nums">{row.original.ref}</span> },
  { id: 'title', header: t('portal.requests.title'), enableSorting: false, cell: ({ row }) => <span className="block truncate text-ink">{row.original.title}</span> },
  { id: 'service', header: t('portal.requests.service'), enableSorting: false, cell: ({ row }) => row.original.subcategory || row.original.service || '—' },
  { id: 'status', header: t('common.status'), size: 120, enableSorting: false, cell: ({ row }) => <StatusPill status={row.original.status} size="sm" /> },
  { id: 'created', header: t('portal.requests.raised'), size: 140, enableSorting: false, cell: ({ row }) => formatDate(row.original.createdAt) },
  { id: 'target', header: t('portal.requests.expectedBy'), size: 150, enableSorting: false, cell: ({ row }) => <TargetDate ticket={row.original} variant="cell" /> },
];

/** The user's own requests (and incidents), open or closed, newest first. */
export function PortalRequestsPage() {
  const { t } = useTranslation();
  const cols = useMemo(() => columns(t), [t]);
  const [state, setState] = useState<'open' | 'closed'>('open');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [q, setQ] = useState('');
  const { data, isLoading, isError, error } = useMyRequests(state, page, q.trim(), pageSize);
  const navigate = useNavigate();

  return (
    <>
      <PageIntro
        title={t('portal.nav.requests')}
        intro={t('portal.requests.intro')}
        action={
          <Link to="/portal/new" className={buttonClasses({ variant: 'primary', size: 'lg', className: 'h-11 px-5' })}>
            <Plus className="size-4" aria-hidden />
            {t('portal.nav.new')}
          </Link>
        }
      />
      <div className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b border-line">
        <div className="flex gap-6" role="tablist" aria-label={t('portal.requests.stateLabel')}>
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
              {s === 'open' ? t('portal.requests.open') : t('portal.requests.closed')}
            </button>
          ))}
        </div>
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={t('portal.requests.searchPlaceholder')}
          aria-label={t('portal.requests.searchLabel')}
          leadingIcon={<Search className="size-4" />}
          className="mb-3 h-10 w-full sm:w-72"
        />
      </div>
      {isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {error instanceof Error ? error.message : t('portal.requests.loadError')}
        </div>
      ) : null}
      {/* Phones: a stacked list; the table needs more width than a phone has. */}
      <ul className="-mt-6 divide-y divide-line border-b border-line sm:hidden" aria-label={t('portal.nav.requests')}>
        {isLoading ? (
          <li className="py-6 text-[14px] text-ink-secondary">{t('common.loading')}</li>
        ) : !data || data.items.length === 0 ? (
          <li className="py-6 text-[14px] text-ink-secondary">{state === 'open' ? t('portal.requests.noOpen') : t('portal.requests.noClosed')}</li>
        ) : (
          data.items.map((ticket) => (
            <li key={ticket.id}>
              <Link to={`/portal/requests/${ticket.id}`} className="block py-4 hover:bg-surface-hover">
                <span className="flex items-center justify-between gap-3 text-[13px] text-ink-secondary">
                  <span className="tabular-nums">{ticket.ref}</span>
                  <span>{formatDate(ticket.createdAt)}</span>
                </span>
                <span className="mt-1 block text-[16px] text-ink">{ticket.title}</span>
                <span className="mt-2 flex items-center gap-3">
                  <StatusPill status={ticket.status} size="sm" />
                  <span className="truncate text-[13px] text-ink-secondary">{ticket.subcategory || ticket.service}</span>
                </span>
                {ticket.targetDate && !ticket.closed ? (
                  <span className="mt-1 block text-[13px] text-ink-secondary">
                    {t('portal.requests.expectedBy')} <TargetDate ticket={ticket} variant="cell" />
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
            columns={cols}
            isLoading={isLoading}
            loadingRows={5}
            emptyTitle={state === 'open' ? t('portal.requests.noOpen') : t('portal.requests.noClosed')}
            emptyDescription={state === 'open' ? t('portal.requests.emptyOpen') : undefined}
            onRowClick={(t) => navigate(`/portal/requests/${t.id}`)}
            // The pager below serves the phone list too.
            pagination={false}
          />
        </div>
        {data ? (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data.total}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
            className="max-sm:border-t-0 max-sm:px-0"
          />
        ) : null}
      </Card>
    </>
  );
}

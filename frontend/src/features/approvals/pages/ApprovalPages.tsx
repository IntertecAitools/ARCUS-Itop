import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { buttonClasses, Card, Skeleton, Tabs } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-display';
import { Eyebrow, PageIntro } from '@/components/public';
import { cn } from '@/lib/utils';
import { useAnswerApproval, useApproval, useApprovals } from '../api/approvals.api';
import { ApprovalStatusPill, ApprovalView, when } from '../components/ApprovalParts';
import type { ApprovalDecision, ApprovalSummary } from '../types';

type State = 'pending' | 'decided';

const alert = (e: unknown, fallback: string) => (
  <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
    {e instanceof Error ? e.message : fallback}
  </div>
);

const levelText = (a: ApprovalSummary) => (a.levels > 1 ? `Level ${a.level} of ${a.levels}` : '');

function columns(state: State): Column<ApprovalSummary>[] {
  return [
    { id: 'ref', header: 'Request', size: 110, enableSorting: false, cell: ({ row }) => <span className="text-ink-secondary tabular-nums">{row.original.request.ref}</span> },
    { id: 'title', header: 'Title', enableSorting: false, cell: ({ row }) => <span className="block truncate text-ink">{row.original.request.title}</span> },
    { id: 'requester', header: 'Requested by', enableSorting: false, cell: ({ row }) => <span className="block truncate">{row.original.request.requester || '—'}</span> },
    { id: 'service', header: 'Service', enableSorting: false, cell: ({ row }) => <span className="block truncate">{row.original.request.subcategory || row.original.request.service || '—'}</span> },
    state === 'pending'
      ? { id: 'since', header: 'Waiting since', size: 150, enableSorting: false, cell: ({ row }) => when(row.original.startedAt) }
      : {
          id: 'answer',
          header: 'Your answer',
          size: 150,
          enableSorting: false,
          cell: ({ row }) => (
            <span className={row.original.myAnswer?.decision === 'approved' ? 'text-good-ink' : 'text-serious-ink'}>
              {row.original.myAnswer?.decision === 'approved' ? 'Approved' : 'Rejected'}
            </span>
          ),
        },
    {
      id: 'status',
      header: 'Approval',
      size: 170,
      enableSorting: false,
      cell: ({ row }) => (
        <span className="flex flex-col items-start gap-0.5">
          <ApprovalStatusPill status={row.original.status} size="sm" />
          {row.original.status === 'pending' && levelText(row.original) ? (
            <span className="text-[11px] text-ink-muted">{levelText(row.original)}</span>
          ) : null}
        </span>
      ),
    },
  ];
}

/** Staff: the approvals waiting for my answer, and the ones I decided. */
export function ApprovalListPage() {
  const [state, setState] = useState<State>('pending');
  const { data, isLoading, isError, error } = useApprovals(state);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Approvals' }]}
        title="Approvals"
        description="Requests that need your approval before the service desk works on them."
      />
      <Tabs
        className="mb-4"
        value={state}
        onChange={(id) => setState(id as State)}
        items={[
          { id: 'pending', label: 'Waiting for me', ...(data ? { count: data.pending } : {}) },
          { id: 'decided', label: 'Decided by me' },
        ]}
      />
      {isError ? alert(error, 'Approvals could not be loaded.') : null}
      <Card>
        <DataTable
          data={data?.items ?? []}
          columns={columns(state)}
          isLoading={isLoading}
          loadingRows={4}
          emptyTitle={state === 'pending' ? 'Nothing waits for your approval' : 'You have not decided any approvals lately'}
          emptyDescription={
            state === 'pending' ? 'When a request needs your approval, it appears here and you are emailed.' : 'The last 90 days are shown.'
          }
          onRowClick={(a) => navigate(`/approvals/${a.id}`)}
        />
      </Card>
    </>
  );
}

function useAnswer(id: string) {
  const answer = useAnswerApproval(id);
  const pending: ApprovalDecision | null = answer.isPending ? (answer.variables?.decision ?? null) : null;
  return {
    pending,
    error: answer.error as Error | null,
    onAnswer: (decision: ApprovalDecision, comment: string) => answer.mutate({ decision, comment }),
  };
}

/** Staff: one approval. */
export function ApprovalDetailPage() {
  const { id = '' } = useParams();
  const { data: approval, isLoading, isError, error } = useApproval(id);
  const answer = useAnswer(id);
  if (isLoading) return <Skeleton className="h-96" />;
  if (isError || !approval) return alert(error, 'This approval could not be found.');
  return (
    <>
      <PageHeader
        breadcrumbs={[
          { label: 'Home', to: '/' },
          { label: 'Approvals', to: '/approvals' },
          { label: approval.request.ref },
        ]}
        title={approval.request.title}
        description={`${approval.request.ref} · requested by ${approval.request.requester || 'someone'}`}
        actions={
          <>
            <ApprovalStatusPill status={approval.status} />
            <Link
              to={`/records/UserRequest/${approval.request.id}`}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              <ExternalLink className="size-4" aria-hidden />
              Open the request
            </Link>
          </>
        }
      />
      <ApprovalView approval={approval} {...answer} />
    </>
  );
}

/** End users: the approvals waiting for them, and the ones they decided. */
export function PortalApprovalsPage() {
  const [state, setState] = useState<State>('pending');
  const { data, isLoading, isError, error } = useApprovals(state);
  return (
    <>
      <PageIntro title="Approvals" intro="Requests from your colleagues that need your approval." />
      <div className="mb-6 flex gap-6 border-b border-line" role="tablist" aria-label="Approvals">
        {(['pending', 'decided'] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={state === s}
            onClick={() => setState(s)}
            className={cn(
              '-mb-px border-b-2 pb-3 text-[15px] transition-colors',
              state === s ? 'border-ink text-ink' : 'border-transparent text-ink-secondary hover:text-ink',
            )}
          >
            {s === 'pending' ? `Waiting for me${data && state === 'pending' ? ` (${data.pending})` : ''}` : 'Decided by me'}
          </button>
        ))}
      </div>
      {isError ? alert(error, 'Approvals could not be loaded.') : null}
      <ul className="divide-y divide-line border-b border-line" aria-label="Approvals">
        {isLoading ? (
          <li className="py-6 text-[14px] text-ink-secondary">Loading…</li>
        ) : !data || data.items.length === 0 ? (
          <li className="py-6 text-[14px] text-ink-secondary">
            {state === 'pending' ? 'Nothing waits for your approval.' : 'You have not decided any approvals lately.'}
          </li>
        ) : (
          data.items.map((a) => (
            <li key={a.id}>
              <Link
                to={`/portal/approvals/${a.id}`}
                className="flex flex-wrap items-center gap-x-6 gap-y-1 px-1 py-5 transition-colors hover:bg-surface-hover sm:flex-nowrap"
              >
                <span className="w-28 shrink-0 text-[13px] tracking-wide text-ink-secondary tabular-nums">{a.request.ref}</span>
                <span className="min-w-0 flex-1 basis-full sm:basis-auto">
                  <span className="block truncate text-[16px] text-ink">{a.request.title}</span>
                  <span className="block truncate text-[13px] text-ink-secondary">
                    {a.request.requester}
                    {a.request.subcategory || a.request.service ? ` · ${a.request.subcategory || a.request.service}` : ''}
                  </span>
                </span>
                <ApprovalStatusPill status={a.status} size="sm" />
              </Link>
            </li>
          ))
        )}
      </ul>
    </>
  );
}

/** End users: one approval, in the portal's look. */
export function PortalApprovalPage() {
  const { id = '' } = useParams();
  const { data: approval, isLoading, isError, error } = useApproval(id);
  const answer = useAnswer(id);
  if (isLoading) return <Skeleton className="h-96" />;
  if (isError || !approval) return alert(error, 'This approval could not be found.');
  return (
    <>
      <Link to="/portal/approvals" className="mb-8 inline-flex items-center gap-1.5 text-[14px] text-ink-secondary hover:text-ink">
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        Approvals
      </Link>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <Eyebrow className="normal-case tracking-normal">
            {approval.request.ref} · requested by {approval.request.requester || 'a colleague'}
          </Eyebrow>
          <h1 className="display mt-4 max-w-4xl text-[32px] break-words sm:text-[44px]">{approval.request.title}</h1>
        </div>
        <ApprovalStatusPill status={approval.status} />
      </div>
      <ApprovalView approval={approval} {...answer} />
    </>
  );
}

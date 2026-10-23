import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { StatusPill } from '@/components/data-display';
import { Eyebrow, publicControl } from '@/components/public';
import { cn } from '@/lib/utils';
import { AttachmentsPanel } from '@/features/attachments';
import { RequestApprovalCard } from '@/features/approvals';
import { useMyRequest, useRequestActions } from '../api/portal.api';
import { formatDate } from './PortalRequestsPage';
import { TargetDate } from '../components/TargetDate';

const TEXTAREA = publicControl;

const SATISFACTION = [
  { value: '1', label: 'Very satisfied' },
  { value: '2', label: 'Fairly satisfied' },
  { value: '3', label: 'Rather dissatisfied' },
  { value: '4', label: 'Very dissatisfied' },
];

/** iTop stores Text and case logs as HTML; show them as text, never as markup. */
function plain(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    // List items (a request form's answers) as "- " lines.
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

/** One of the user's requests: what is happening, the conversation, files, and close/reopen. */
export function PortalRequestPage() {
  const { id = '' } = useParams();
  const { data: ticket, isLoading, isError, error } = useMyRequest(id);
  const { comment, close, reopen } = useRequestActions(id);
  const [message, setMessage] = useState('');
  const [closing, setClosing] = useState(false);
  const [satisfaction, setSatisfaction] = useState('');
  const [closeComment, setCloseComment] = useState('');
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState('');

  if (isLoading) return <Skeleton className="h-96" />;
  if (isError || !ticket) {
    return (
      <div role="alert" className="rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
        {error instanceof Error ? error.message : 'This request could not be found.'}
      </div>
    );
  }

  const actionError = (close.error ?? reopen.error) as Error | null;

  return (
    <>
      <Link to="/portal/requests" className="mb-8 inline-flex items-center gap-1.5 text-[14px] text-ink-secondary hover:text-ink">
        <ArrowLeft className="size-4 rtl:-scale-x-100" aria-hidden />
        My requests
      </Link>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div className="min-w-0">
          <Eyebrow className="normal-case tracking-normal">
            {ticket.ref} · {ticket.kind === 'incident' ? 'Incident' : 'Request'} · raised {formatDate(ticket.createdAt)}
          </Eyebrow>
          <h1 className="display mt-4 max-w-4xl text-[32px] break-words sm:text-[44px]">{ticket.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill status={ticket.status} />
          {ticket.actions.includes('close') ? (
            <Button size="sm" onClick={() => setClosing((c) => !c)}>
              Confirm and close
            </Button>
          ) : null}
          {ticket.actions.includes('reopen') ? (
            <Button size="sm" variant="secondary" onClick={() => setReopening((r) => !r)}>
              Reopen
            </Button>
          ) : null}
        </div>
      </div>

      {ticket.targetDate ? (
        <div className="-mt-4 mb-8 max-w-3xl">
          <TargetDate ticket={ticket} variant="panel" />
        </div>
      ) : null}

      {actionError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {actionError.message}
        </div>
      ) : null}

      {closing ? (
        <Card className="mb-4">
          <CardHeader title="Is the problem solved?" subtitle="Closing confirms the resolution. Tell us how it went." />
          <CardBody className="space-y-3">
            <div className="flex flex-wrap gap-4 text-[13px] text-ink">
              {SATISFACTION.map((s) => (
                <label key={s.value} className="flex items-center gap-2">
                  <input type="radio" name="satisfaction" checked={satisfaction === s.value} onChange={() => setSatisfaction(s.value)} />
                  {s.label}
                </label>
              ))}
            </div>
            <textarea rows={3} className={TEXTAREA} placeholder="Anything to add? (optional)" value={closeComment} onChange={(e) => setCloseComment(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setClosing(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                loading={close.isPending}
                onClick={() =>
                  close.mutate(
                    { ...(satisfaction ? { satisfaction } : {}), ...(closeComment.trim() ? { comment: closeComment.trim() } : {}) },
                    { onSuccess: () => setClosing(false) },
                  )
                }
              >
                Close request
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {reopening ? (
        <Card className="mb-4">
          <CardHeader title="Reopen this request" subtitle="Say what is still wrong; the support team is notified." />
          <CardBody className="space-y-3">
            <textarea rows={3} className={TEXTAREA} value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setReopening(false)}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!reason.trim()}
                loading={reopen.isPending}
                onClick={() => reopen.mutate(reason.trim(), { onSuccess: () => { setReopening(false); setReason(''); } })}
              >
                Reopen
              </Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Description" />
            <CardBody>
              <p className="text-[15px] leading-7 whitespace-pre-wrap text-ink">{plain(ticket.description) || '—'}</p>
              {ticket.solution ? (
                <div className="mt-5 rounded-card border border-good/40 bg-good-soft px-4 py-3">
                  <p className="text-[12px] font-medium text-good-ink">Solution</p>
                  <p className="mt-1 text-[13px] whitespace-pre-wrap text-ink">{plain(ticket.solution)}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Conversation" />
            <CardBody className="space-y-4">
              {!ticket.closed ? (
                <div>
                  <textarea rows={3} className={TEXTAREA} placeholder="Write a message to the support team…" value={message} onChange={(e) => setMessage(e.target.value)} />
                  {comment.isError ? (
                    <p role="alert" className="mt-1 text-[12px] text-critical-ink">{(comment.error as Error).message}</p>
                  ) : null}
                  <div className="mt-2 flex justify-end">
                    <Button size="sm" disabled={!message.trim()} loading={comment.isPending} onClick={() => comment.mutate(message.trim(), { onSuccess: () => setMessage('') })}>
                      Send
                    </Button>
                  </div>
                </div>
              ) : null}
              {ticket.log.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No messages yet.</p>
              ) : (
                <ol className="space-y-3">
                  {ticket.log.map((entry, i) => (
                    <li key={i} className="border-s-2 border-line-strong ps-4">
                      <p className="text-[12px] text-ink-muted">
                        {entry.author || 'Support'} · {formatDate(entry.date)}
                      </p>
                      <p className="mt-1 text-[15px] leading-7 whitespace-pre-wrap text-ink">{plain(entry.message)}</p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>

          <AttachmentsPanel
            className={ticket.kind === 'incident' ? 'Incident' : 'UserRequest'}
            id={String(ticket.id)}
            basePath={`/portal/requests/${ticket.id}/attachments`}
            canDelete={false}
          />
        </div>

        <div className="space-y-6">
        <Card className="h-fit">
          <CardHeader title="Details" />
          <CardBody>
            <dl className="space-y-4 text-[14px]">
              {[
                ['Service', ticket.subcategory ? `${ticket.service} › ${ticket.subcategory}` : ticket.service],
                ['Handled by', [ticket.agent, ticket.team].filter(Boolean).join(' · ')],
                ['Raised for', ticket.caller],
                ['Expected by', ticket.targetDate ? formatDate(ticket.targetDate) : ''],
                ['Last update', formatDate(ticket.updatedAt)],
                ['Resolved', ticket.resolvedAt ? formatDate(ticket.resolvedAt) : ''],
                ['Closed', ticket.closedAt ? formatDate(ticket.closedAt) : ''],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[12px] text-ink-muted">{label}</dt>
                  <dd className={cn('text-ink', !value && 'text-ink-muted')}>{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        {ticket.kind === 'request' ? <RequestApprovalCard audience="portal" requestId={String(ticket.id)} /> : null}
        </div>
      </div>
    </>
  );
}

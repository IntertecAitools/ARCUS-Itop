import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { StatusPill } from '@/components/data-display';
import { cn } from '@/lib/utils';
import { AttachmentsPanel } from '@/features/attachments';
import { useMyRequest, useRequestActions } from '../api/portal.api';
import { formatDate } from './PortalRequestsPage';

const TEXTAREA =
  'w-full rounded-control border border-line bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-muted focus:border-brand focus:outline-none';

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
      <Link to="/portal/requests" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-secondary hover:text-ink">
        <ArrowLeft className="size-4" />
        My requests
      </Link>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[12px] text-ink-muted">
            {ticket.ref} · {ticket.kind === 'incident' ? 'Incident' : 'Request'} · raised {formatDate(ticket.createdAt)}
          </p>
          <h1 className="mt-0.5 text-[20px] font-semibold text-ink">{ticket.title}</h1>
        </div>
        <div className="flex items-center gap-2">
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader title="Description" />
            <CardBody>
              <p className="text-[13px] whitespace-pre-wrap text-ink">{plain(ticket.description) || '—'}</p>
              {ticket.solution ? (
                <div className="mt-4 rounded-card border border-good/30 bg-good-soft px-3 py-2">
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
                    <li key={i} className="border-l-2 border-line pl-3">
                      <p className="text-[12px] text-ink-muted">
                        {entry.author || 'Support'} · {formatDate(entry.date)}
                      </p>
                      <p className="mt-0.5 text-[13px] whitespace-pre-wrap text-ink">{plain(entry.message)}</p>
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

        <Card className="h-fit">
          <CardHeader title="Details" />
          <CardBody>
            <dl className="space-y-2.5 text-[13px]">
              {[
                ['Service', ticket.subcategory ? `${ticket.service} › ${ticket.subcategory}` : ticket.service],
                ['Handled by', [ticket.agent, ticket.team].filter(Boolean).join(' · ')],
                ['Raised for', ticket.caller],
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
      </div>
    </>
  );
}

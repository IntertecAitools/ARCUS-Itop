import { useState } from 'react';
import { Check, Clock, X } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, Skeleton, type BadgeTone } from '@/components/ui';
import { publicControl } from '@/components/public';
import { cn, dateTimeText } from '@/lib/utils';
import { useRequestApproval } from '../api/approvals.api';
import type { ApprovalDecision, ApprovalDetail, ApprovalLevel, ApprovalStatus } from '../types';

const STATUS: Record<ApprovalStatus, { tone: BadgeTone; label: string }> = {
  pending: { tone: 'warning', label: 'Awaiting approval' },
  approved: { tone: 'good', label: 'Approved' },
  rejected: { tone: 'serious', label: 'Rejected' },
};

/** Where an approval stands: colour, dot and words, never colour alone. */
export function ApprovalStatusPill({ status, size = 'md' }: { status: ApprovalStatus; size?: 'sm' | 'md' }) {
  const meta = STATUS[status];
  return (
    <Badge tone={meta.tone} dot size={size}>
      {meta.label}
    </Badge>
  );
}

const LEVEL_TEXT: Record<ApprovalLevel['status'], string> = {
  waiting: 'Not started',
  in_progress: 'Waiting for answers',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const when = (value: string) => (value ? dateTimeText(value) : '—');

/** Each level of the approval, its approvers and what they answered. */
export function ApprovalLevels({ steps }: { steps: ApprovalLevel[] }) {
  if (steps.length === 0) return <p className="text-[13px] text-ink-muted">No approvers.</p>;
  return (
    <ol className="space-y-5">
      {steps.map((step) => (
        <li key={step.level}>
          <p className="text-[12px] font-medium text-ink-muted">
            {steps.length > 1 ? `Level ${step.level} · ` : ''}
            {LEVEL_TEXT[step.status]}
          </p>
          <ul className="mt-2 space-y-3">
            {step.approvers.map((a, i) => (
              <li key={i} className="flex gap-3">
                <span
                  className={cn(
                    'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
                    a.decision === 'approved'
                      ? 'bg-good-soft text-good-ink'
                      : a.decision === 'rejected'
                        ? 'bg-serious-soft text-serious-ink'
                        : 'bg-neutral-soft text-neutral-ink',
                  )}
                  aria-hidden
                >
                  {a.decision === 'approved' ? (
                    <Check className="size-3.5" />
                  ) : a.decision === 'rejected' ? (
                    <X className="size-3.5" />
                  ) : (
                    <Clock className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 text-[14px]">
                  <p className="text-ink">
                    {a.name}
                    <span className="text-ink-muted">
                      {' · '}
                      {a.decision === 'approved' ? 'approved' : a.decision === 'rejected' ? 'rejected' : 'no answer yet'}
                      {a.at ? ` ${when(a.at)}` : ''}
                    </span>
                  </p>
                  {a.answeredBy ? <p className="text-[12px] text-ink-muted">Answered by {a.answeredBy}, standing in</p> : null}
                  {a.comment ? (
                    <p className="mt-1 text-[13px] whitespace-pre-wrap text-ink-secondary">“{a.comment}”</p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

/** Approve or reject with a comment; a rejection must say why. */
export function ApprovalDecisionForm({
  onAnswer,
  pending,
  error,
}: {
  onAnswer: (decision: ApprovalDecision, comment: string) => void;
  pending: ApprovalDecision | null;
  error: Error | null;
}) {
  const [comment, setComment] = useState('');
  const [tried, setTried] = useState(false);
  const reject = () => {
    setTried(true);
    if (comment.trim()) onAnswer('rejected', comment.trim());
  };
  const missing = tried && !comment.trim();
  return (
    <div className="space-y-3">
      <label htmlFor="approval-comment" className="block text-[13px] font-medium text-ink">
        Comment <span className="font-normal text-ink-muted">(required to reject)</span>
      </label>
      <textarea
        id="approval-comment"
        rows={3}
        className={publicControl}
        value={comment}
        aria-invalid={missing || undefined}
        aria-describedby={missing ? 'approval-comment-error' : undefined}
        onChange={(e) => setComment(e.target.value)}
        placeholder="Add a note for the requester and the service desk…"
      />
      {missing ? (
        <p id="approval-comment-error" role="alert" className="text-[12px] text-critical-ink">
          Say why you reject it.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-[12px] text-critical-ink">
          {error.message}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="danger" disabled={pending !== null} loading={pending === 'rejected'} onClick={reject}>
          <X className="size-4" aria-hidden />
          Reject
        </Button>
        <Button
          disabled={pending !== null}
          loading={pending === 'approved'}
          onClick={() => onAnswer('approved', comment.trim())}
        >
          <Check className="size-4" aria-hidden />
          Approve
        </Button>
      </div>
    </div>
  );
}

/**
 * The body of an approval screen, the same for staff and end users: the
 * request to judge, the answer form while the user's answer is awaited, and
 * the levels so far.
 */
export function ApprovalView({
  approval,
  onAnswer,
  pending,
  error,
}: {
  approval: ApprovalDetail;
  onAnswer: (decision: ApprovalDecision, comment: string) => void;
  pending: ApprovalDecision | null;
  error: Error | null;
}) {
  const { request } = approval;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {approval.awaitingMe ? (
          <Card>
            <CardHeader title="Your answer" subtitle="The requester and the service desk see your comment." />
            <CardBody>
              <ApprovalDecisionForm onAnswer={onAnswer} pending={pending} error={error} />
            </CardBody>
          </Card>
        ) : approval.myAnswer ? (
          <div
            role="status"
            className={cn(
              'rounded-card border px-4 py-3 text-[14px]',
              approval.myAnswer.decision === 'approved'
                ? 'border-good/40 bg-good-soft text-good-ink'
                : 'border-serious/40 bg-serious-soft text-serious-ink',
            )}
          >
            You {approval.myAnswer.decision} this {when(approval.myAnswer.at)}
            {approval.myAnswer.comment ? `: “${approval.myAnswer.comment}”` : '.'}
          </div>
        ) : null}

        <Card>
          <CardHeader title="Request" subtitle={`${request.ref} · raised ${when(request.createdAt)}`} />
          <CardBody>
            <p className="text-[15px] leading-7 whitespace-pre-wrap text-ink">{approval.description || '—'}</p>
          </CardBody>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="space-y-4 text-[14px]">
              {[
                ['Requested by', request.requester],
                ['Organization', request.organization],
                ['Service', request.subcategory ? `${request.service} › ${request.subcategory}` : request.service],
                ['Approval started', when(approval.startedAt)],
                ['Decided', approval.endedAt ? when(approval.endedAt) : ''],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[12px] text-ink-muted">{label}</dt>
                  <dd className={cn('text-ink', !value && 'text-ink-muted')}>{value || '—'}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Approvers" action={<ApprovalStatusPill status={approval.status} size="sm" />} />
          <CardBody>
            <ApprovalLevels steps={approval.steps} />
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/** The approval on a user request, shown with the request; nothing when it had none. */
export function RequestApprovalCard({
  audience,
  requestId,
  className,
}: {
  audience: 'staff' | 'portal';
  requestId: string;
  className?: string;
}) {
  const { data: approval, isLoading } = useRequestApproval(audience, requestId);
  if (isLoading) return <Skeleton className={cn('h-32', className)} />;
  if (!approval) return null;
  return (
    <Card className={className}>
      <CardHeader title="Approval" action={<ApprovalStatusPill status={approval.status} size="sm" />} />
      <CardBody>
        <ApprovalLevels steps={approval.steps} />
      </CardBody>
    </Card>
  );
}

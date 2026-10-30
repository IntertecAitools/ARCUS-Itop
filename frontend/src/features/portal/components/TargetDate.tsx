import { CalendarClock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn, dateTimeText, relativeTime } from '@/lib/utils';
import type { PortalTicket } from '../types';

type Target = Pick<PortalTicket, 'targetDate' | 'targetMissed' | 'status' | 'closed'>;

/** Resolved or closed: the target no longer tells the requester anything about waiting. */
const done = (t: Target) => t.closed || t.status === 'resolved' || t.status === 'closed';

/** Past its target and still open: the SLA flag, or the clock if iTop has not checked yet. */
export const isOverdue = (t: Target, now = Date.now()) =>
  !done(t) && Boolean(t.targetDate) && (t.targetMissed || new Date(t.targetDate).getTime() < now);

/**
 * When the requester can expect their request to be resolved: the
 * time-to-resolve deadline iTop computes from the SLA that applies. Shows
 * nothing when no SLA applies, rather than inventing a date.
 *
 * `cell` is the compact form for the requests list; `panel` the line on a
 * request's own page.
 */
export function TargetDate({ ticket, variant }: { ticket: Target; variant: 'cell' | 'panel' }) {
  const { t } = useTranslation();
  if (!ticket.targetDate) return variant === 'cell' ? <span className="text-ink-muted">—</span> : null;
  const overdue = isOverdue(ticket);
  const when = dateTimeText(ticket.targetDate);

  if (variant === 'cell') {
    if (done(ticket)) return <span className="text-ink-muted">—</span>;
    return (
      <span className={cn('tabular-nums', overdue ? 'text-critical-ink' : 'text-ink')} title={overdue ? t('portal.target.past') : undefined}>
        {when}
        {overdue ? <span className="sr-only">{t('portal.target.overdue')}</span> : null}
      </span>
    );
  }

  const text = done(ticket)
    ? ticket.targetMissed
      ? t('portal.target.resolvedAfter', { when })
      : t('portal.target.resolvedWithin', { when })
    : overdue
      ? t('portal.target.late', { when })
      : t('portal.target.expected', { when, relative: relativeTime(ticket.targetDate) });

  return (
    <p
      data-testid="target-date"
      className={cn(
        'flex items-start gap-2 rounded-card border px-4 py-3 text-[14px]',
        overdue ? 'border-warning/40 bg-warning-soft text-warning-ink' : 'border-line bg-surface-sunken text-ink',
      )}
    >
      <CalendarClock className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{text}</span>
    </p>
  );
}

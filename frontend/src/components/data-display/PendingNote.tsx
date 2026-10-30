import { AlarmClock, PauseCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PendingInfo } from '@/types/ticket';
import { intlLocale } from '@/lib/i18n';

/** `2026-10-30` as "30 Oct 2026", without a time zone shifting the day. */
export function dayLabel(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(intlLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * A ticket on hold: when to act again, and why. Overdue reads in the critical
 * tone with its own icon and the word "overdue", so colour is never the only cue.
 *
 * `compact` is the one-line form for table cells; the reason moves to the tooltip.
 */
export function PendingNote({
  pending,
  compact = false,
  className,
}: {
  pending: PendingInfo;
  compact?: boolean;
  className?: string;
}) {
  const Icon = pending.overdue ? AlarmClock : PauseCircle;
  const when = pending.nextActionDate
    ? `${pending.overdue ? 'Overdue since' : 'Act by'} ${dayLabel(pending.nextActionDate)}`
    : 'No next-action date';
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-start gap-1.5 text-[12px]',
        pending.overdue ? 'font-medium text-critical-ink' : 'text-ink-secondary',
        className,
      )}
      title={compact && pending.reason ? `On hold: ${pending.reason}` : undefined}
      data-overdue={pending.overdue || undefined}
    >
      <Icon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="whitespace-nowrap">{when}</span>
        {!compact && pending.reason ? (
          <span className="block text-ink-secondary font-normal">{pending.reason}</span>
        ) : null}
      </span>
    </span>
  );
}

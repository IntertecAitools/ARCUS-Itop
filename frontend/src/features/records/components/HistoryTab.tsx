import { Card, CardBody, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { dateTimeText } from '@/lib/utils';
import { useHistory } from '../api/useRecords';
import type { HistoryChange } from '../types';

/** A change line; date-time values are shown on the viewer's clock. */
function changeText(change: HistoryChange) {
  if (change.valueKind !== 'datetime') return change.text;
  const show = (v?: string) => (v ? dateTimeText(v) : '(empty)');
  return `${change.label ?? change.attcode}: ${show(change.oldValue)} → ${show(change.newValue)}`;
}

/**
 * A record's history: every save, newest first, with who made it and what it
 * changed — iTop's "History" tab. The wording is done by the BFF, which
 * resolves enum codes and record ids to names.
 */
export function HistoryTab({ className, id }: { className: string; id: string }) {
  const { data, isLoading, isError, error } = useHistory(className, id, true);

  if (isLoading) return <Skeleton className="h-40" />;
  if (isError) {
    return (
      <div
        role="alert"
        className="rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
      >
        Couldn’t load the history. {error instanceof Error ? error.message : ''}
      </div>
    );
  }
  if (!data || data.items.length === 0) {
    return (
      <Card>
        <EmptyState title="No history yet" description="No changes have been recorded for this record." />
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <ol className="space-y-4">
          {data.items.map((entry) => (
            <li key={entry.id} className="border-s-2 border-line ps-3">
              <div className="text-[12px] text-ink-muted">
                {dateTimeText(entry.date)} · {entry.user || 'Unknown user'}
                {entry.comment && entry.comment !== entry.user ? <span> — {entry.comment}</span> : null}
              </div>
              <ul className="mt-1 space-y-0.5 text-[13px] text-ink">
                {entry.changes.map((change, i) => (
                  <li key={i}>{changeText(change)}</li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {data.truncated ? (
          <p className="mt-3 text-[12px] text-ink-muted">
            iTop holds {data.total} changes for this record; only part of them is shown.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

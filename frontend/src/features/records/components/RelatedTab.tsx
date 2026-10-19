import { Link } from 'react-router-dom';

import { Card, CardBody, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useRelated } from '../api/useRecords';
import type { ClassInfo } from '../types';

/**
 * The objects on the far side of a LinkedSet.
 *
 * iTop renders these as tabs on a record — the CIs a problem affects, the
 * contacts on a ticket — and the detail screen was dropping them entirely,
 * which is most of what a ticket is about. 123 attributes across the
 * datamodel are of this kind.
 */
export function RelatedTab({
  info,
  id,
  attcode,
}: {
  info: ClassInfo;
  id: string;
  attcode: string;
}) {
  const { data, isLoading, isError, error } = useRelated(info.name, id, attcode);
  // iTop's wording for the tab. The underlying class is often a link table
  // (`lnkContactToTicket`), which is an implementation detail and reads as
  // noise to anyone looking at a ticket.
  const label = info.labels?.fields?.[attcode];

  if (isLoading) return <Skeleton className="h-40" />;

  if (isError) {
    return (
      <div
        role="alert"
        className="rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
      >
        Couldn’t load these related records.{' '}
        {error instanceof Error ? error.message : ''}
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Nothing linked yet"
          description={
            label
              ? `This record has no ${label.toLowerCase()} yet.`
              : 'No records are linked here.'
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <ul className="divide-y divide-line">
          {data.items.map((row) => (
            <li key={`${row.class}-${row.id}`} className="py-2 text-[13px]">
              {/* A link class (lnkPersonToTeam) has no screen worth opening on
                  its own, so only real objects become links. */}
              {row.class.startsWith('lnk') ? (
                <span className="text-ink">{row.label || `#${row.id}`}</span>
              ) : (
                <Link
                  to={`/records/${row.class}/${row.id}`}
                  className="text-brand-ink hover:underline"
                >
                  {row.label || `${row.class} #${row.id}`}
                </Link>
              )}
              <span className="ml-2 font-mono text-[11px] text-ink-muted">{row.class}</span>
            </li>
          ))}
        </ul>
        {data.hasMore ? (
          <p className="mt-2 text-[12px] text-ink-muted">
            Showing {data.items.length} of {data.total}.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

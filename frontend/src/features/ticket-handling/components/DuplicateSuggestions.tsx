import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy } from 'lucide-react';
import { StatusPill } from '@/components/data-display';
import { cn } from '@/lib/utils';
import { useDuplicateSuggestions } from '../api/useTicketHandling';
import { ticketPath } from '../lib/format';
import type { DuplicateQuery, HandledClass } from '../types';

/** The query, once the typing has paused; `null` while there is too little to go on. */
function useSettled(query: DuplicateQuery | null, ms = 500): DuplicateQuery | null {
  const [settled, setSettled] = useState(query);
  const key = JSON.stringify(query);
  useEffect(() => {
    const t = setTimeout(() => setSettled(query), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key is the query's value
  }, [key, ms]);
  return settled;
}

const toId = (v: string | number | undefined) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
};

/**
 * "These open tickets look the same", shown while a new ticket is written:
 * same caller, CI or service, or a similar title. Opens in a new tab, so
 * nothing typed is lost.
 */
export function DuplicateSuggestions({
  ticketClass,
  title,
  orgId,
  callerId,
  serviceId,
  className,
}: {
  ticketClass: HandledClass;
  title: string;
  orgId?: string | number;
  callerId?: string | number;
  serviceId?: string | number;
  className?: string;
}) {
  const trimmed = title.trim();
  const query: DuplicateQuery | null =
    trimmed.length >= 4 || toId(callerId)
      ? {
          class: ticketClass,
          title: trimmed,
          ...(toId(orgId) ? { orgId: toId(orgId) } : {}),
          ...(toId(callerId) ? { callerId: toId(callerId) } : {}),
          ...(toId(serviceId) ? { serviceId: toId(serviceId) } : {}),
        }
      : null;
  const { data } = useDuplicateSuggestions(useSettled(query));
  const items = query ? (data?.items ?? []) : [];
  if (items.length === 0) return null;

  return (
    <section
      aria-label="Possible duplicates"
      className={cn('rounded-card border border-warning/30 bg-warning-soft px-4 py-3', className)}
    >
      <p className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink">
        <Copy className="size-3.5" aria-hidden />
        Already raised? {items.length === 1 ? 'This open ticket looks similar' : 'These open tickets look similar'}
      </p>
      <ul className="space-y-1.5">
        {items.map((s) => (
          <li key={`${s.class}-${s.id}`} className="text-[13px]">
            <Link to={ticketPath(s.class, s.id)} target="_blank" rel="noreferrer" className="font-medium text-brand-ink hover:underline">
              {s.ref}
            </Link>{' '}
            <span className="text-ink">{s.title}</span> <StatusPill status={s.status} size="sm" />
            <span className="block text-[12px] text-ink-muted">
              {s.reasons.join(' · ')}
              {s.caller ? ` · ${s.caller}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

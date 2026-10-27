import { Link } from 'react-router-dom';
import { Siren } from 'lucide-react';
import { isModuleRegistered } from '@/config/modules';
import { relativeTime } from '@/lib/utils';
import type { MajorIncidentSummary } from '../types';

/**
 * Open major incidents, at the top of the dashboard where nobody can miss
 * them. Renders nothing when there are none.
 */
export function MajorIncidentsBanner({ items }: { items?: MajorIncidentSummary[] }) {
  if (!items?.length) return null;
  const linkable = isModuleRegistered('/incidents');
  return (
    <section
      role="alert"
      aria-label="Major incidents"
      className="rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-critical-ink"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold">
          <Siren className="size-4 shrink-0" aria-hidden />
          {items.length === 1 ? '1 major incident is open' : `${items.length} major incidents are open`}
        </p>
        {linkable ? (
          <Link to="/incidents?major=true&status=new,open,pending" className="text-[13px] font-medium underline">
            View all
          </Link>
        ) : null}
      </div>
      <ul className="mt-1.5 space-y-0.5 text-[13px]">
        {items.slice(0, 3).map((item) => (
          <li key={item.id} className="truncate">
            {linkable ? (
              <Link to={`/incidents/${item.id}`} className="font-medium hover:underline">
                {item.ref}
              </Link>
            ) : (
              <span className="font-medium">{item.ref}</span>
            )}{' '}
            {item.summary}
            <span className="text-critical-ink/80"> · raised {relativeTime(item.createdAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

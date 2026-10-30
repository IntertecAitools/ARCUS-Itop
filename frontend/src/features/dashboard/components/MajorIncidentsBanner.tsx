import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Siren } from 'lucide-react';
import { isModuleRegistered } from '@/config/modules';
import { relativeTime } from '@/lib/utils';
import type { MajorIncidentSummary } from '../types';

/**
 * Open major incidents, at the top of the dashboard where nobody can miss
 * them. Renders nothing when there are none.
 */
export function MajorIncidentsBanner({ items }: { items?: MajorIncidentSummary[] }) {
  const { t } = useTranslation();
  if (!items?.length) return null;
  const linkable = isModuleRegistered('/incidents');
  return (
    <section
      role="alert"
      aria-label={t('dashboard.major.label')}
      className="rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-critical-ink"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold">
          <Siren className="size-4 shrink-0" aria-hidden />
          {items.length === 1 ? t('dashboard.major.one') : t('dashboard.major.many', { count: items.length })}
        </p>
        {linkable ? (
          <Link to="/incidents?major=true&status=new,open,pending" className="text-[13px] font-medium underline">
            {t('dashboard.viewAll')}
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
            <span className="text-critical-ink/80"> · {t('dashboard.major.raised', { when: relativeTime(item.createdAt) })}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

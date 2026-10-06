'use client';

import { useTranslation } from 'react-i18next';
import { MessageSquare } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { formatDateTime, initial, sanitizeHtml } from '@/lib/utils';
import type { CaseLogEntry } from '../types';

/** Read-only rendering of an iTop case log, newest entry first. */
export function CaseLog({ entries }: { entries: CaseLogEntry[] }) {
  const { t } = useTranslation('tickets');
  if (entries.length === 0) {
    return <EmptyState icon={MessageSquare} title={t('caseLog.emptyTitle')} description={t('caseLog.emptyDescription')} />;
  }
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <ol aria-label={t('caseLog.label')} className="space-y-4">
      {sorted.map((entry, index) => {
        const name = entry.user_name ?? entry.user_login;
        return (
          <li key={`${entry.date}-${index}`} className="flex gap-3">
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
              aria-hidden
            >
              {initial(name)}
            </span>
            <div className="min-w-0 flex-1 rounded-control border border-border bg-surface-muted px-4 py-3">
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="text-sm font-semibold text-text">{name}</p>
                <time dateTime={entry.date} className="text-xs text-text-muted">
                  {formatDateTime(entry.date)}
                </time>
              </div>
              <div className="rich-text text-sm text-text" dangerouslySetInnerHTML={{ __html: sanitizeHtml(entry.message_html) }} />
            </div>
          </li>
        );
      })}
    </ol>
  );
}

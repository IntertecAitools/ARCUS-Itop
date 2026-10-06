'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { Lightbulb, Search } from 'lucide-react';
import { Skeleton } from '@/components/feedback';
import { Input } from '@/components/ui';
import { routes } from '@/config';
import { useDebounce } from '@/hooks';
import { useKnownErrors } from '../api/knownErrors';
import type { KnownErrorSummary } from '../types';
import { DomainBadge } from './DomainBadge';

export interface KedbSearchProps {
  id?: string;
  /** Initial search text (e.g. a problem title) */
  defaultQuery?: string;
  limit?: number;
  /** When given, results become buttons instead of links */
  onSelect?: (knownError: KnownErrorSummary) => void;
}

/** Reusable Known Error Database search: type symptoms, error codes or product names. */
export function KedbSearch({ id = 'kedb-search', defaultQuery = '', limit = 5, onSelect }: KedbSearchProps) {
  const { t } = useTranslation('knowledgeBase');
  const [query, setQuery] = useState(defaultQuery);
  const q = useDebounce(query.trim(), 300);
  const { data, isFetching } = useKnownErrors({ q, page: 1, pageSize: limit });

  return (
    <div className="space-y-3">
      <label htmlFor={id} className="sr-only">
        {t('kedbSearch.label')}
      </label>
      <Input
        id={id}
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('kedbSearch.placeholder')}
        leftIcon={<Search className="size-4" aria-hidden />}
      />
      <div aria-live="polite">
        {isFetching && !data ? (
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : data && data.items.length > 0 ? (
          <ul className="divide-y divide-border rounded-control border border-border">
            {data.items.map((ke) => {
              const content = (
                <>
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-warning-strong" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text">{ke.name}</span>
                    <span className="block text-xs text-text-muted">
                      {[ke.error_code, ke.problem_ref].filter(Boolean).join(' · ') || ke.org_name}
                    </span>
                  </span>
                  <DomainBadge domain={ke.domain} />
                </>
              );
              const cls = 'flex w-full items-start gap-3 px-3 py-2.5 text-left hover:bg-surface-muted';
              return (
                <li key={ke.id}>
                  {onSelect ? (
                    <button type="button" className={cls} onClick={() => onSelect(ke)}>
                      {content}
                    </button>
                  ) : (
                    <Link href={routes.knownErrors.detail(ke.id)} className={cls}>
                      {content}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="py-3 text-center text-sm text-text-muted">{t('kedbSearch.noResults')}</p>
        )}
      </div>
    </div>
  );
}

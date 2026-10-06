'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataTableColumn, type DataTablePagination } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { routes } from '@/config';
import type { KnownErrorSummary } from '../types';
import { DomainBadge } from './DomainBadge';

export interface KnownErrorTableProps {
  rows: KnownErrorSummary[];
  loading?: boolean;
  pagination?: DataTablePagination;
  /** Hide the problem column (when shown inside a problem) */
  hideProblem?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
}

export function KnownErrorTable({ rows, loading, pagination, hideProblem, emptyTitle, emptyDescription }: KnownErrorTableProps) {
  const { t } = useTranslation('knowledgeBase');

  const columns: DataTableColumn<KnownErrorSummary>[] = [
    {
      id: 'name',
      header: t('fields.name'),
      hideable: false,
      cell: (r) => (
        <Link href={routes.knownErrors.detail(r.id)} className="font-medium text-link hover:underline">
          {r.name}
        </Link>
      ),
    },
    { id: 'error_code', header: t('fields.errorCode'), cell: (r) => r.error_code || '—' },
    { id: 'domain', header: t('fields.domain'), cell: (r) => <DomainBadge domain={r.domain} /> },
    {
      id: 'vmv',
      header: t('fields.vendorModelVersion'),
      cell: (r) => [r.vendor, r.model, r.version].filter(Boolean).join(' · ') || '—',
    },
    { id: 'org', header: t('fields.org'), cell: (r) => r.org_name, defaultHidden: hideProblem },
  ];
  if (!hideProblem) {
    columns.push({
      id: 'problem',
      header: t('fields.problem'),
      cell: (r) =>
        r.problem_id ? (
          <Link href={routes.problems.detail(r.problem_id)} className="text-link hover:underline">
            {r.problem_ref}
          </Link>
        ) : (
          '—'
        ),
    });
  }

  return (
    <DataTable
      caption={t('tableCaption')}
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      loading={loading}
      pagination={pagination}
      emptyState={<EmptyState title={emptyTitle ?? t('emptyTitle')} description={emptyDescription ?? t('emptyDescription')} />}
    />
  );
}

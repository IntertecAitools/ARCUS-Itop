'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { DataTable, type DataTableColumn, type DataTablePagination } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { routes } from '@/config';
import { formatDate, formatDateTime } from '@/lib/utils';
import type { SortState } from '@/types';
import type { ProblemSummary } from '../types';
import { ProblemPriorityBadge, ProblemStatusPill } from './ProblemBadges';

/** "-start_date" ⇄ { id: 'start_date', direction: 'desc' } */
export function sortFromString(sort: string): SortState {
  return sort.startsWith('-') ? { id: sort.slice(1), direction: 'desc' } : { id: sort, direction: 'asc' };
}

export function sortToString(sort: SortState): string {
  return sort.direction === 'desc' ? `-${sort.id}` : sort.id;
}

export interface ProblemTableProps {
  rows: ProblemSummary[];
  loading?: boolean;
  sort?: string;
  onSortChange?: (sort: string) => void;
  pagination?: DataTablePagination;
  /** Compact variant for dashboard cards */
  compact?: boolean;
  toolbar?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;
}

export function useProblemColumns(compact = false): DataTableColumn<ProblemSummary>[] {
  const { t } = useTranslation('problems');
  const dash = (v: string | null) => v || '—';

  const ref: DataTableColumn<ProblemSummary> = {
    id: 'ref',
    header: compact ? t('columns.id') : t('fields.ref'),
    sortable: true,
    hideable: false,
    cell: (r) => (
      <Link href={routes.problems.detail(r.id)} className="font-medium whitespace-nowrap text-link hover:underline">
        {r.ref}
      </Link>
    ),
  };
  const title: DataTableColumn<ProblemSummary> = {
    id: 'title',
    header: compact ? t('columns.summary') : t('fields.title'),
    sortable: true,
    hideable: false,
    cell: (r) => <span className="line-clamp-1 max-w-md min-w-40">{r.title}</span>,
  };
  const priority: DataTableColumn<ProblemSummary> = {
    id: 'priority',
    header: t('fields.priority'),
    sortable: true,
    cell: (r) => <ProblemPriorityBadge priority={r.priority} />,
  };
  const status: DataTableColumn<ProblemSummary> = {
    id: 'status',
    header: t('fields.status'),
    sortable: true,
    cell: (r) => <ProblemStatusPill status={r.status} />,
  };
  const created: DataTableColumn<ProblemSummary> = {
    id: 'start_date',
    header: t('columns.created'),
    sortable: true,
    cell: (r) => <span className="whitespace-nowrap">{formatDate(r.start_date)}</span>,
  };

  if (compact) return [ref, title, priority, status, created];

  return [
    ref,
    title,
    { id: 'org_name', header: t('fields.org_id'), sortable: true, cell: (r) => r.org_name },
    { id: 'service_name', header: t('fields.service_id'), sortable: true, cell: (r) => dash(r.service_name) },
    priority,
    status,
    { id: 'team_name', header: t('fields.team_id'), sortable: true, cell: (r) => dash(r.team_name) },
    { id: 'agent_name', header: t('fields.agent_id'), sortable: true, cell: (r) => dash(r.agent_name) },
    created,
    {
      id: 'last_update',
      header: t('fields.last_update'),
      sortable: true,
      defaultHidden: true,
      cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.last_update)}</span>,
    },
  ];
}

export function ProblemTable({
  rows,
  loading,
  sort,
  onSortChange,
  pagination,
  compact = false,
  toolbar,
  emptyTitle,
  emptyDescription,
  emptyAction,
}: ProblemTableProps) {
  const { t } = useTranslation('problems');
  const columns = useProblemColumns(compact);
  return (
    <DataTable
      caption={t('list.caption')}
      columns={columns}
      rows={rows}
      getRowId={(r) => r.id}
      loading={loading}
      skeletonRows={compact ? 5 : 10}
      sort={sort ? sortFromString(sort) : null}
      onSortChange={onSortChange ? (s) => onSortChange(sortToString(s)) : undefined}
      pagination={pagination}
      columnChooser={!compact}
      storageKey={compact ? undefined : 'problems'}
      toolbar={toolbar}
      emptyState={
        <EmptyState
          title={emptyTitle ?? t('list.emptyTitle')}
          description={emptyDescription ?? t('list.emptyDescription')}
          action={emptyAction}
        />
      }
    />
  );
}

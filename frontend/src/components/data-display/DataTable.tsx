'use client';

import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SortState } from '@/types';
import { Skeleton } from '@/components/feedback';
import { Popover } from '@/components/overlays';
import { Button, Checkbox, Select } from '@/components/ui';

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  /** Column can be turned off in the column chooser (default true) */
  hideable?: boolean;
  defaultHidden?: boolean;
  className?: string;
}

export interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}

export interface DataTableProps<T> {
  /** Accessible name of the table */
  caption: string;
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  loading?: boolean;
  skeletonRows?: number;
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  pagination?: DataTablePagination;
  columnChooser?: boolean;
  /** Persist the visible-column choice in localStorage under this key */
  storageKey?: string;
  /** Extra actions shown next to the column chooser (e.g. CSV export) */
  toolbar?: ReactNode;
  emptyState?: ReactNode;
  className?: string;
}

function initialHidden<T>(columns: DataTableColumn<T>[], storageKey?: string): string[] {
  if (storageKey && typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem(`table-cols:${storageKey}`);
      if (saved) return JSON.parse(saved) as string[];
    } catch {
      // ignore unreadable storage
    }
  }
  return columns.filter((c) => c.defaultHidden).map((c) => c.id);
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  getRowId,
  loading = false,
  skeletonRows = 5,
  sort,
  onSortChange,
  pagination,
  columnChooser = false,
  storageKey,
  toolbar,
  emptyState,
  className,
}: DataTableProps<T>) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState<string[]>(() => initialHidden(columns, storageKey));
  const visible = columns.filter((c) => !hidden.includes(c.id));

  function toggleColumn(id: string) {
    setHidden((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (storageKey) window.localStorage.setItem(`table-cols:${storageKey}`, JSON.stringify(next));
      return next;
    });
  }

  function onHeaderClick(column: DataTableColumn<T>) {
    if (!column.sortable || !onSortChange) return;
    const direction = sort?.id === column.id && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ id: column.id, direction });
  }

  const showToolbar = columnChooser || toolbar;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  const from = pagination && pagination.total > 0 ? (pagination.page - 1) * pagination.pageSize + 1 : 0;
  const to = pagination ? Math.min(pagination.page * pagination.pageSize, pagination.total) : rows.length;

  return (
    <div className={cn('flex flex-col', className)}>
      {showToolbar && (
        <div className="flex flex-wrap items-center justify-end gap-2 pb-3">
          {toolbar}
          {columnChooser && (
            <Popover
              label={t('table.columns')}
              trigger={(props) => (
                <Button variant="secondary" size="sm" leftIcon={<Columns3 className="size-4" aria-hidden />} {...props}>
                  {t('table.columns')}
                </Button>
              )}
            >
              <fieldset className="space-y-2">
                <legend className="mb-2 text-xs font-semibold tracking-wide text-text-muted uppercase">
                  {t('table.visibleColumns')}
                </legend>
                {columns.map((c) => (
                  <Checkbox
                    key={c.id}
                    id={`col-${storageKey ?? 'table'}-${c.id}`}
                    label={c.header}
                    checked={!hidden.includes(c.id)}
                    disabled={c.hideable === false}
                    onChange={() => toggleColumn(c.id)}
                    className="flex"
                  />
                ))}
              </fieldset>
            </Popover>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-control border border-border">
        <table className="w-full border-collapse text-sm" aria-busy={loading || undefined}>
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-surface-muted">
            <tr>
              {visible.map((column) => {
                const active = sort?.id === column.id;
                const SortIcon = !active ? ArrowUpDown : sort?.direction === 'asc' ? ArrowUp : ArrowDown;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={active ? (sort?.direction === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn(
                      'h-10 px-4 text-left text-xs font-semibold whitespace-nowrap text-text-muted',
                      column.className,
                    )}
                  >
                    {column.sortable && onSortChange ? (
                      <button
                        type="button"
                        onClick={() => onHeaderClick(column)}
                        className={cn('inline-flex items-center gap-1 hover:text-text', active && 'text-text')}
                      >
                        {column.header}
                        <SortIcon className="size-3.5" aria-hidden />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {loading &&
              Array.from({ length: skeletonRows }, (_, i) => (
                <tr key={`skeleton-${i}`} className="h-11 border-t border-border">
                  {visible.map((c) => (
                    <td key={c.id} className="px-4">
                      <Skeleton className="h-4 w-full max-w-32" />
                    </td>
                  ))}
                </tr>
              ))}
            {!loading &&
              rows.map((row) => (
                <tr key={getRowId(row)} className="h-11 border-t border-border transition-colors hover:bg-primary-soft/40">
                  {visible.map((c) => (
                    <td key={c.id} className={cn('px-4 py-2 align-middle text-text', c.className)}>
                      {c.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            {!loading && rows.length === 0 && (
              <tr className="border-t border-border">
                <td colSpan={visible.length}>{emptyState ?? <p className="p-8 text-center text-text-muted">{t('table.empty')}</p>}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pagination && (
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 text-sm text-text-muted">
          <p aria-live="polite">{t('table.range', { from, to, total: pagination.total })}</p>
          <div className="flex items-center gap-2">
            {pagination.onPageSizeChange && (
              <label className="flex items-center gap-2">
                <span>{t('table.rowsPerPage')}</span>
                <Select
                  className="w-20"
                  value={String(pagination.pageSize)}
                  onChange={(e) => pagination.onPageSizeChange?.(Number(e.target.value))}
                  options={(pagination.pageSizeOptions ?? [10, 25, 50]).map((n) => ({ value: String(n), label: String(n) }))}
                />
              </label>
            )}
            <Button
              variant="secondary"
              size="icon"
              aria-label={t('table.previousPage')}
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </Button>
            <span>{t('table.pageOf', { page: pagination.page, pages: totalPages })}</span>
            <Button
              variant="secondary"
              size="icon"
              aria-label={t('table.nextPage')}
              disabled={pagination.page >= totalPages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              <ChevronRight className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

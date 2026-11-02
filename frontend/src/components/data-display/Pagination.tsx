import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IconButton } from '@/components/ui';
import '@/lib/i18n';

/** The page sizes every list offers. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

/** What a list shows before the user picks a size. */
export const DEFAULT_PAGE_SIZE = 25;

/**
 * A page size read from the URL or storage: one of the offered sizes, or the
 * default. Anything else (a hand-edited `?limit=7`) would leave the size
 * picker showing a value it does not have.
 */
export function parsePageSize(raw: unknown, fallback: number = DEFAULT_PAGE_SIZE): number {
  const size = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(size) ? size : fallback;
}

export interface PaginationProps {
  /** 1-based. */
  page: number;
  pageSize: number;
  /** Rows across every page. */
  total: number;
  onPageChange: (page: number) => void;
  /** Leave out for a fixed page size: the size picker is then not shown. */
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: readonly number[];
  className?: string;
}

/**
 * The one pager under every list.
 *
 * It states the range ("Showing 26–50 of 312"), not just a page number, and
 * offers first / previous / next / last plus a page size. A list that fits on
 * the smallest page shows no pager at all: one page of controls that all do
 * nothing is noise.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  className,
}: PaginationProps) {
  const { t } = useTranslation();
  const smallest = Math.min(...pageSizeOptions);
  if (total <= 0 || (total <= smallest && page <= 1)) return null;

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pages);
  const first = (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);
  const go = (next: number) => onPageChange(Math.min(Math.max(1, next), pages));

  return (
    <nav
      aria-label={t('pagination.label')}
      className={cn(
        'flex flex-col gap-3 border-t border-line px-4 py-3 text-[13px] text-ink-muted',
        'sm:flex-row sm:items-center sm:justify-between',
        className,
      )}
    >
      <p aria-live="polite" className="tabular-nums">
        {t('pagination.showing', { first, last, total })}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:justify-end">
        {onPageSizeChange ? (
          <label className="flex items-center gap-2 whitespace-nowrap">
            {t('pagination.rowsPerPage')}
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 cursor-pointer rounded-control border border-line-strong bg-surface ps-2 pe-1 text-[13px] text-ink tabular-nums outline-none focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <div className="flex items-center gap-1">
          <IconButton
            size="sm"
            label={t('pagination.first')}
            icon={<ChevronsLeft className="size-4 rtl:-scale-x-100" />}
            disabled={current <= 1}
            onClick={() => go(1)}
          />
          <IconButton
            size="sm"
            label={t('pagination.previous')}
            icon={<ChevronLeft className="size-4 rtl:-scale-x-100" />}
            disabled={current <= 1}
            onClick={() => go(current - 1)}
          />
          <span className="px-2 whitespace-nowrap text-ink-secondary tabular-nums">
            {t('pagination.pageOf', { page: current, pages })}
          </span>
          <IconButton
            size="sm"
            label={t('pagination.next')}
            icon={<ChevronRight className="size-4 rtl:-scale-x-100" />}
            disabled={current >= pages}
            onClick={() => go(current + 1)}
          />
          <IconButton
            size="sm"
            label={t('pagination.last')}
            icon={<ChevronsRight className="size-4 rtl:-scale-x-100" />}
            disabled={current >= pages}
            onClick={() => go(pages)}
          />
        </div>
      </div>
    </nav>
  );
}

import { useState } from 'react';
import { DEFAULT_PAGE_SIZE, type PaginationProps } from './Pagination';

/**
 * Client-side paging for a list rendered by hand (a plain `<table>` or a
 * list), with the same pager DataTable uses.
 *
 * Back to the first page whenever the row count or `resetKey` changes — a new
 * filter or search is a new list, and page 4 of it may not exist.
 */
export function usePagedRows<T>(
  rows: readonly T[],
  { resetKey, pageSize: initialPageSize = DEFAULT_PAGE_SIZE }: { resetKey?: string | number; pageSize?: number } = {},
) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);

  // Adjusted while rendering, not in an effect, so the stale page never paints.
  const key = `${rows.length}|${resetKey ?? ''}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setPage(1);
  }

  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pages);

  const pagination: PaginationProps = {
    page: current,
    pageSize,
    total: rows.length,
    onPageChange: setPage,
    onPageSizeChange: (size) => {
      setPageSize(size);
      setPage(1);
    },
  };

  return { pageRows: rows.slice((current - 1) * pageSize, current * pageSize), pagination };
}

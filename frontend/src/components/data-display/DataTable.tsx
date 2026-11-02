import { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from '@tanstack/react-table';
import { ChevronsUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/feedback';
import { Skeleton } from '@/components/ui';
import { DEFAULT_PAGE_SIZE, Pagination, type PaginationProps } from './Pagination';

/**
 * A column definition for this table.
 *
 * The value generic is left open: TanStack infers a different value type per
 * accessor, and pinning it would force every call site to build a
 * heterogeneous tuple by hand.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Column<T> = ColumnDef<T, any>;

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  /** Row click — usually "open the ticket". Makes the whole row a target. */
  onRowClick?: (row: T) => void;
  isLoading?: boolean;
  /** Skeleton rows to show while loading, so the card keeps its height. */
  loadingRows?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  density?: 'compact' | 'comfortable';
  className?: string;
  /**
   * How the rows are paged.
   *
   * - left out: `data` is the whole list and the table pages it itself, with
   *   the shared pager under it (sorting applies across every page);
   * - a pager's props: `data` is one page the server sent, and the pager
   *   drives the server's paging;
   * - `false`: no paging — a short, fixed list such as a dashboard's top five,
   *   or a page that renders its own pager.
   */
  pagination?: PaginationProps | false;
  /** The first page size when the table pages itself. */
  pageSize?: number;
  /**
   * When the table pages itself: a value that changes when the list's filters
   * or search do, to go back to the first page. A change in the row count does
   * that already; this covers a filter that swaps rows without changing it.
   */
  resetPageKey?: string | number;
}

/**
 * The one table in the app. Every module's list screen builds on this, so
 * sorting affordances, empty states, loading behaviour, cell padding, row
 * heights and paging stay identical everywhere.
 */
export function DataTable<T>({
  data,
  columns,
  onRowClick,
  isLoading,
  loadingRows = 5,
  emptyTitle = 'Nothing here yet',
  emptyDescription,
  density = 'comfortable',
  className,
  pagination,
  pageSize = DEFAULT_PAGE_SIZE,
  resetPageKey,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const pagesItself = pagination === undefined;
  const [paging, setPaging] = useState<PaginationState>({ pageIndex: 0, pageSize });

  // A new filter or search is a new list: back to its first page. Adjusted
  // while rendering (not in an effect) so the stale page never paints.
  const resetKey = `${data.length}|${resetPageKey ?? ''}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setPaging((current) => ({ ...current, pageIndex: 0 }));
  }

  const table = useReactTable({
    data,
    columns,
    state: pagesItself ? { sorting, pagination: paging } : { sorting },
    onSortingChange: (updater) => {
      setSorting(updater);
      // A re-sorted list starts again at the top.
      setPaging((current) => ({ ...current, pageIndex: 0 }));
    },
    onPaginationChange: setPaging,
    autoResetPageIndex: false,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(pagesItself ? { getPaginationRowModel: getPaginationRowModel() } : {}),
  });

  // Comfortable is the default everywhere; compact is for dense cards.
  const cellPadding = density === 'compact' ? 'px-3 py-2' : 'px-4 py-3';

  /**
   * The width below which the table scrolls rather than squeezing.
   *
   * `table-fixed w-full` on its own keeps the table inside its container no
   * matter how many columns it has, so adding a column silently crushes the
   * others — far enough that a truncating cell can reach zero width and its
   * text stops being rendered at all, which reads as missing data rather than
   * as a layout problem. A minimum width restores the container's
   * `overflow-x-auto`: columns keep their declared size and the table scrolls.
   */
  const minWidth = columns.reduce<number>(
    (total, column) => total + (typeof column.size === 'number' ? column.size : 160),
    0,
  );

  if (!isLoading && data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const pager = pagesItself ? (
    <Pagination
      page={paging.pageIndex + 1}
      pageSize={paging.pageSize}
      total={data.length}
      onPageChange={(page) => setPaging((current) => ({ ...current, pageIndex: page - 1 }))}
      onPageSizeChange={(size) => setPaging({ pageIndex: 0, pageSize: size })}
    />
  ) : pagination && !isLoading ? (
    <Pagination {...pagination} />
  ) : null;

  return (
    <>
      {/* `relative`: the header cells' sr-only sort labels are absolutely positioned;
          without a positioned scroll box they escape it and widen the whole page. */}
      <div className={cn('relative w-full overflow-x-auto', className)}>
        {/* `table-fixed` makes the declared column sizes authoritative, so a long
            summary truncates instead of shoving the trailing columns off the card. */}
        <table
          style={{ minWidth: `${minWidth}px` }}
          className="w-full table-fixed border-collapse text-start"
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-b border-line bg-surface-sunken">
                {headerGroup.headers.map((header) => {
                  const sortable = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      style={{ width: header.getSize() === 150 ? undefined : header.getSize() }}
                      className={cn(
                        'align-middle text-[12px] font-medium text-ink-muted whitespace-nowrap',
                        cellPadding,
                      )}
                    >
                      {header.isPlaceholder ? null : sortable ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="inline-flex items-center gap-1 rounded transition-colors hover:text-ink-secondary"
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ChevronUp className="size-3" aria-hidden />
                          ) : sorted === 'desc' ? (
                            <ChevronDown className="size-3" aria-hidden />
                          ) : (
                            <ChevronsUpDown className="size-3 opacity-50" aria-hidden />
                          )}
                          <span className="sr-only">
                            {sorted === 'asc'
                              ? 'sorted ascending'
                              : sorted === 'desc'
                                ? 'sorted descending'
                                : 'not sorted'}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody>
            {isLoading
              ? Array.from({ length: loadingRows }).map((_, rowIndex) => (
                  <tr key={`skeleton-${rowIndex}`} className="border-b border-line last:border-0">
                    {columns.map((_col, colIndex) => (
                      <td key={colIndex} className={cellPadding}>
                        <Skeleton className="h-4 w-full max-w-28" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    // A clickable row is a keyboard target too (WCAG 2.1.1): it
                    // takes focus, and Enter opens it. Only when the row itself
                    // has focus, so Enter on a link or checkbox inside keeps its
                    // own meaning.
                    tabIndex={onRowClick ? 0 : undefined}
                    onKeyDown={
                      onRowClick
                        ? (e) => {
                            if (e.key === 'Enter' && e.target === e.currentTarget) {
                              e.preventDefault();
                              onRowClick(row.original);
                            }
                          }
                        : undefined
                    }
                    className={cn(
                      'border-b border-line last:border-0',
                      onRowClick &&
                        'cursor-pointer transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:-outline-offset-2',
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={cn('align-middle text-[13px] text-ink-secondary', cellPadding)}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
      {pager}
    </>
  );
}

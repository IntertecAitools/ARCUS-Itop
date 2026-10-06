import { useState } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
} from '@tanstack/react-table';
import { ChevronsUpDown, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { EmptyState } from '@/components/feedback';
import { Skeleton } from '@/components/ui';

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
}

/**
 * The one table in the app. Every module's list screen builds on this, so
 * sorting affordances, empty states, loading behaviour and row heights stay
 * identical everywhere.
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
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const cellPadding = density === 'compact' ? 'px-2 py-2' : 'px-2.5 py-2.5';

  if (!isLoading && data.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      {/* `table-fixed` makes the declared column sizes authoritative, so a long
          summary truncates instead of shoving the trailing columns off the card. */}
      <table className="w-full table-fixed border-collapse text-left">
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="border-b border-line">
              {headerGroup.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                return (
                  <th
                    key={header.id}
                    scope="col"
                    style={{ width: header.getSize() === 150 ? undefined : header.getSize() }}
                    className={cn(
                      'text-[12px] font-medium text-ink-muted whitespace-nowrap',
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
                  className={cn(
                    'border-b border-line last:border-0',
                    onRowClick && 'cursor-pointer transition-colors hover:bg-surface-hover',
                  )}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={cn('text-[13px] text-ink-secondary', cellPadding)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}

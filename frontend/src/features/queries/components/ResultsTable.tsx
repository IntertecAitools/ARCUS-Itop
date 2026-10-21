import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database } from 'lucide-react';
import { buttonClasses } from '@/components/ui';
import { DataTable } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { recordColumns, type ClassInfo } from '@/features/records';
import type { QueryResult } from '../types';

/**
 * A query's records, in the same table as a records list: the id and each
 * picker link into the record screens.
 */
export function ResultsTable({
  info,
  columns,
  result,
  isLoading,
  page,
  onPage,
}: {
  info: ClassInfo;
  columns: string[];
  result: QueryResult | undefined;
  isLoading: boolean;
  page: number;
  onPage: (page: number) => void;
}) {
  const navigate = useNavigate();
  const tableColumns = useMemo(() => recordColumns(info.name, info, columns), [info, columns]);

  if (!isLoading && result?.items.length === 0) {
    return (
      <EmptyState
        icon={<Database className="size-5" />}
        title="No records match"
        description="Nothing you can see matches this query."
      />
    );
  }

  return (
    <>
      <DataTable
        data={result?.items ?? []}
        columns={tableColumns}
        isLoading={isLoading}
        loadingRows={8}
        onRowClick={(record) => navigate(`/records/${info.name}/${record.id}`)}
      />
      {result && result.pages > 1 ? (
        <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3">
          <p className="text-[13px] text-ink-muted tabular-nums">
            Page {result.page} of {result.pages} · {result.total} total
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={page >= result.pages}
              onClick={() => onPage(page + 1)}
              className={buttonClasses({ variant: 'secondary', size: 'sm' })}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

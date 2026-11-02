import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Database } from 'lucide-react';
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
  pageSize,
  onPage,
  onPageSize,
}: {
  info: ClassInfo;
  columns: string[];
  result: QueryResult | undefined;
  isLoading: boolean;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  /** A new page size; the caller goes back to the first page. */
  onPageSize: (pageSize: number) => void;
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
    <DataTable
      data={result?.items ?? []}
      columns={tableColumns}
      isLoading={isLoading}
      loadingRows={8}
      onRowClick={(record) => navigate(`/records/${info.name}/${record.id}`)}
      pagination={{
        page,
        pageSize,
        total: result?.total ?? 0,
        onPageChange: onPage,
        onPageSizeChange: onPageSize,
      }}
    />
  );
}

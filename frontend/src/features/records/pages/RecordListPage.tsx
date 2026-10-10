import { useMemo } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Database, Search } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { buttonClasses, Card, Input, Skeleton } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useClassInfo, useRecords } from '../api/useRecords';
import { humaniseAttcode } from '../components/FieldControls';
import type { RecordDto } from '../types';

/** The handful of columns worth showing for an arbitrary class. */
const MAX_COLUMNS = 6;

export function RecordListPage() {
  const { className = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const page = Math.max(1, Number(params.get('page')) || 1);
  const q = params.get('q') ?? '';

  const { data: info, isLoading: schemaLoading, isError: schemaError, error } = useClassInfo(className);

  /**
   * Which columns to request.
   *
   * Asking iTop for every attribute on a wide class is slow and unreadable, so
   * this takes the first few writable scalars — the fields a human recognises.
   */
  const columns = useMemo(() => {
    if (!info) return [];
    const preferred = ['name', 'friendlyname', 'ref', 'title', 'status', 'org_name'];
    const scalars = info.writable.filter((a) => info.fields[a]?.ui === 'scalar');
    const ordered = [
      ...preferred.filter((a) => info.fields[a]),
      ...scalars.filter((a) => !preferred.includes(a)),
    ];
    return [...new Set(ordered)].slice(0, MAX_COLUMNS);
  }, [info]);

  const fields = columns.length ? ['id', ...columns].join(',') : undefined;
  const { data, isLoading, isError: listError } = useRecords(className, { page, q: q || undefined }, fields);

  const tableColumns = useMemo<Column<RecordDto>[]>(() => {
    const cells: Column<RecordDto>[] = columns.map((attcode) => ({
      id: attcode,
      header: humaniseAttcode(attcode),
      enableSorting: false,
      cell: ({ row }) => {
        const value = row.original.fields[attcode];
        const text = value === null || value === undefined || value === '' ? '—' : String(value);
        return (
          <span className="block truncate text-ink" title={text}>
            {text}
          </span>
        );
      },
    }));

    return [
      {
        id: 'id',
        header: 'ID',
        size: 80,
        enableSorting: false,
        cell: ({ row }) => (
          <Link
            to={`/records/${className}/${row.original.id}`}
            onClick={(e) => e.stopPropagation()}
            className="font-medium whitespace-nowrap text-brand-ink transition-colors hover:underline"
          >
            #{row.original.id}
          </Link>
        ),
      },
      ...cells,
    ];
  }, [columns, className]);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v) next.delete(k);
      else next.set(k, v);
    }
    if (!('page' in patch)) next.delete('page');
    setParams(next, { replace: true });
  };

  if (schemaError) {
    return (
      <>
        <PageHeader
          breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Records', to: '/records' }, { label: className }]}
          title="Unknown class"
        />
        <Card>
          <EmptyState
            icon={<Database className="size-5" />}
            title={`iTop has no class called "${className}"`}
            description={error instanceof Error ? error.message : undefined}
            action={
              <Link to="/records" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                Back to records
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Records', to: '/records' }, { label: className }]}
        title={className}
        description={
          data
            ? `${data.total} ${data.total === 1 ? 'record' : 'records'}${data.sortedInBff ? ' · sorted by the BFF' : ''}`
            : info?.isCi
              ? 'A configuration item.'
              : 'An iTop class.'
        }
        actions={
          <Link to="/records" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            <ArrowLeft className="mr-1.5 size-4" />
            All classes
          </Link>
        }
      />

      {listError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load {className} records.
        </div>
      ) : null}

      <div className="mb-4">
        <Input
          defaultValue={q}
          onChange={(e) => update({ q: e.target.value || undefined })}
          placeholder={`Search ${className}…`}
          aria-label={`Search ${className}`}
          leadingIcon={<Search className="size-4" />}
          className="w-full sm:w-80"
        />
      </div>

      <Card>
        {schemaLoading ? (
          <Skeleton className="m-4 h-64" />
        ) : !isLoading && data?.items.length === 0 ? (
          <EmptyState
            icon={<Database className="size-5" />}
            title={q ? 'No records match that search' : `No ${className} records yet`}
            description={q ? 'Try a shorter term.' : 'Records created in iTop appear here.'}
          />
        ) : (
          <>
            <DataTable
              data={data?.items ?? []}
              columns={tableColumns}
              isLoading={isLoading}
              loadingRows={8}
              onRowClick={(record) => navigate(`/records/${className}/${record.id}`)}
            />
            {data && data.pages > 1 ? (
              <div className="flex items-center justify-between gap-4 border-t border-line px-4 py-3">
                <p className="text-[13px] text-ink-muted tabular-nums">
                  Page {data.page} of {data.pages} · {data.total} total
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => update({ page: String(page - 1) })}
                    className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={page >= data.pages}
                    onClick={() => update({ page: String(page + 1) })}
                    className={buttonClasses({ variant: 'secondary', size: 'sm' })}
                  >
                    Next
                  </button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}

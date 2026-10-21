import { useMemo } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { buttonClasses, Card, Skeleton } from '@/components/ui';
import { ExportMenu, useClassInfo } from '@/features/records';
import { useExportQuery, useQueryResults, useSavedQuery } from '../api/queries.api';
import { ResultsTable } from '../components/ResultsTable';
import { resultColumns, resultFields } from '../lib/queries';

/** `/queries/:id/run`: a saved query's records, as the signed-in user may see them. */
export function QueryRunPage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);

  const { data: query, isLoading: queryLoading, isError, error } = useSavedQuery(id);
  const { data: info } = useClassInfo(query?.recordType ?? '');
  const columns = useMemo(() => (info && query ? resultColumns(query.columns, info) : []), [info, query]);
  const fields = info && columns.length ? resultFields(info, columns) : undefined;
  const results = useQueryResults(query?.runnable ? query.id : undefined, page, fields);
  const exporter = useExportQuery({ id: query?.id ?? 0, name: query?.name ?? '' });

  if (queryLoading) return <Skeleton className="h-96 w-full" />;

  const failure = isError ? error : results.isError ? results.error : null;
  const notRunnable = query && !query.runnable;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Queries', to: '/queries' }, { label: query?.name ?? 'Query' }]}
        title={query?.name ?? 'Query'}
        description={
          results.data
            ? [`${results.data.total} ${results.data.total === 1 ? 'record' : 'records'} you can see`, query?.recordTypeLabel, query?.description]
                .filter(Boolean)
                .join(' · ')
            : query?.description || undefined
        }
        actions={
          <div className="flex items-center gap-2">
            {info && query?.runnable ? (
              <ExportMenu
                info={info}
                listColumns={columns}
                pending={exporter.isPending}
                error={exporter.isError ? (exporter.error instanceof Error ? exporter.error.message : 'The export failed.') : undefined}
                onExport={(format, exported) => exporter.mutate({ format, fields: exported })}
              />
            ) : null}
            {query ? (
              <Link to={`/queries/${query.id}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
                <Pencil className="mr-1.5 size-4" aria-hidden />
                {query.canEdit ? 'Edit' : 'Details'}
              </Link>
            ) : null}
            <Link to="/queries" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              <ArrowLeft className="mr-1.5 size-4" />
              Queries
            </Link>
          </div>
        }
      />

      {failure ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          {failure instanceof Error ? failure.message : 'The query could not be run.'}
        </div>
      ) : null}
      {notRunnable ? (
        <p className="text-[13px] text-ink-secondary">
          {query.parameters.length
            ? 'iTop uses this query in notifications, against the record that set one off; it cannot be run on its own.'
            : 'This query lists something the platform has no screens for.'}
        </p>
      ) : null}

      {query?.runnable ? (
        <Card>
          {info ? (
            <ResultsTable
              info={info}
              columns={columns}
              result={results.data}
              isLoading={results.isLoading || !fields}
              page={page}
              onPage={(next) => setParams(next > 1 ? { page: String(next) } : {}, { replace: true })}
            />
          ) : (
            <Skeleton className="m-4 h-64" />
          )}
        </Card>
      ) : null}
    </>
  );
}

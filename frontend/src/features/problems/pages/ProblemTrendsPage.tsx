import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Repeat } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Badge, Card, CardBody, CardHeader, Select, Skeleton } from '@/components/ui';
import { ChartLegend, DataTable, Sparkline, TrendChart, type Column } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { seriesPalette } from '@/theme';
import { friendlyDateTime } from '@/lib/utils';
import { useProblemTrends } from '../api/useProblems';
import { chartPoints, GROUPINGS, linkedShare, PERIODS, sparkPoints, visibleGroups } from '../lib/trends';
import type { ProblemTrends, TrendGroup, TrendGroupBy, TrendPeriod } from '../types';

const SERIES = [
  { key: 'incidents', label: 'Incidents', filled: true },
  { key: 'linkedIncidents', label: 'Linked to a problem' },
  { key: 'problems', label: 'Problems opened' },
];

type Filter = 'all' | 'recurring' | 'unlinked';

const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All groups' },
  { value: 'recurring', label: 'Recurring only' },
  { value: 'unlinked', label: 'Recurring, no problem yet' },
];

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardBody>
        <p className="text-[13px] text-ink-secondary">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
        {hint ? <p className="mt-0.5 text-[12px] text-ink-muted">{hint}</p> : null}
      </CardBody>
    </Card>
  );
}

function columns(trends: ProblemTrends, noun: string): Column<TrendGroup>[] {
  return [
    {
      id: 'name',
      header: noun,
      accessorKey: 'name',
      size: 220,
      cell: ({ row }) => (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-ink">{row.original.name}</span>
          {row.original.recurring ? (
            <Badge tone="warning" size="sm" icon={<Repeat className="size-3" />}>
              Recurring
            </Badge>
          ) : null}
        </span>
      ),
    },
    { id: 'incidents', header: 'Incidents', accessorKey: 'incidents', size: 90 },
    {
      id: 'unlinked',
      header: 'Without problem',
      accessorKey: 'unlinkedIncidents',
      size: 120,
      cell: ({ getValue }) => {
        const n = getValue() as number;
        return <span className={n ? 'font-medium text-ink' : 'text-ink-muted'}>{n}</span>;
      },
    },
    {
      id: 'trend',
      header: 'Over time',
      enableSorting: false,
      size: 140,
      cell: ({ row }) => (
        <Sparkline
          data={sparkPoints(row.original, trends)}
          color={seriesPalette[0]}
          variant="bars"
          width={110}
          height={26}
          ariaLabel={`${row.original.name}: incidents over time`}
        />
      ),
    },
    {
      id: 'problems',
      header: 'Problems',
      enableSorting: false,
      size: 160,
      cell: ({ row }) =>
        row.original.problemRefs.length ? (
          <span className="flex flex-wrap gap-x-2 gap-y-0.5">
            {row.original.problemRefs.map((p) => (
              <Link
                key={p.id}
                to={`/records/Problem/${p.id}`}
                className="text-brand-ink hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {p.ref}
              </Link>
            ))}
          </span>
        ) : row.original.recurring ? (
          <Link to="/records/Problem/new" className="text-brand-ink hover:underline">
            Open a problem
          </Link>
        ) : (
          <span className="text-ink-muted">None</span>
        ),
    },
    {
      id: 'last',
      header: 'Last incident',
      accessorKey: 'lastIncidentAt',
      size: 150,
      cell: ({ getValue }) => {
        const at = getValue() as string | undefined;
        return at ? friendlyDateTime(at) : <span className="text-ink-muted">None</span>;
      },
    },
  ];
}

/**
 * Problems and their incidents over time, grouped by service, CI or category,
 * so issues that keep coming back stand out, and those no problem covers yet.
 */
export function ProblemTrendsPage() {
  const [period, setPeriod] = useState<TrendPeriod>('90d');
  const [groupBy, setGroupBy] = useState<TrendGroupBy>('service');
  const [filter, setFilter] = useState<Filter>('all');
  const { data, isLoading, isError, error, isFetching } = useProblemTrends({ period, groupBy });

  const grouping = GROUPINGS.find((g) => g.value === groupBy)!;
  const cols = useMemo(() => (data ? columns(data, grouping.noun) : []), [data, grouping.noun]);
  const points = data ? chartPoints(data) : [];
  const hasData = !!data && (data.totals.incidents > 0 || data.totals.problems > 0);
  const legend = SERIES.map((s, i) => ({ key: s.key, label: s.label, color: seriesPalette[i] }));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Problem trends' }]}
        title="Problem trends"
        description="Incidents that keep coming back, and whether a problem covers them."
        actions={
          <>
            <Select
              aria-label="Period"
              className="w-40"
              value={period}
              onChange={(e) => setPeriod(e.target.value as TrendPeriod)}
              options={PERIODS}
            />
            <Select
              aria-label="Group by"
              className="w-52"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as TrendGroupBy)}
              options={GROUPINGS}
            />
          </>
        }
      />

      {isError ? (
        <div role="alert" className="mb-6 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load the trends. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}

      {data?.truncated ? (
        <div role="status" className="mb-4 rounded-card border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-ink">
          More tickets than the trend reads in one go: the counts below are a lower bound. Pick a shorter period for exact numbers.
        </div>
      ) : null}

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !data ? (
          Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
        ) : (
          <>
            <Stat label="Incidents" value={String(data.totals.incidents)} />
            <Stat label="Linked to a problem" value={`${linkedShare(data)}%`} hint={`${data.totals.linkedIncidents} incidents`} />
            <Stat label="Problems opened" value={String(data.totals.problems)} />
            <Stat
              label="Recurring"
              value={String(data.totals.recurringGroups)}
              hint={`${data.recurringRule.minIncidents}+ incidents in ${data.recurringRule.minBuckets}+ ${data.bucket}s`}
            />
          </>
        )}
      </div>

      <Card className="mb-4">
        <CardHeader
          title={`Per ${data?.bucket ?? 'week'}`}
          action={hasData ? <ChartLegend items={legend} /> : undefined}
        />
        <CardBody>
          {isLoading || !data ? (
            <Skeleton className="h-[232px] w-full" />
          ) : hasData ? (
            <TrendChart data={points} xKey="label" series={SERIES} />
          ) : (
            <EmptyState
              className="h-[232px] py-0"
              icon={<LineChart className="size-5" />}
              title="No incidents or problems in this period"
              description="Pick a longer period, or come back once tickets are logged."
            />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={grouping.label}
          subtitle="Most incidents first. A recurring group with incidents no problem covers is a candidate for a new problem."
          action={
            <Select
              aria-label="Show"
              className="w-56"
              value={filter}
              onChange={(e) => setFilter(e.target.value as Filter)}
              options={FILTERS}
            />
          }
        />
        <CardBody>
          <DataTable
            data={data ? visibleGroups(data, filter) : []}
            columns={cols}
            isLoading={isLoading || (isFetching && !data)}
            density="compact"
            emptyTitle={filter === 'all' ? 'Nothing in this period' : 'No recurring groups'}
            emptyDescription={
              filter === 'all' ? undefined : 'Nothing has come back often enough in this period to stand out.'
            }
          />
        </CardBody>
      </Card>
    </>
  );
}

import { LineChart } from 'lucide-react';
import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { ChartLegend, TrendChart } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { seriesPalette } from '@/theme';
import type { TrendPoint } from '../types';

const SERIES = [
  { key: 'created', label: 'Created', filled: true },
  { key: 'resolved', label: 'Resolved' },
];

/**
 * Created vs resolved over the selected window.
 *
 * Both measures are counts of tickets, so they share ONE y-axis — the gap
 * between the lines is the backlog, and that reading only works on a common
 * scale. Never give one of them its own axis.
 */
export function IncidentTrendCard({
  data,
  isLoading,
}: {
  data?: TrendPoint[];
  isLoading: boolean;
}) {
  const legendItems = SERIES.map((s, i) => ({
    key: s.key,
    label: s.label,
    color: seriesPalette[i],
  }));

  // A window of all-zero days is "nothing happened", not a chart worth drawing —
  // a flat line pinned to the baseline says less than the empty state does.
  const hasData = !!data?.some((point) => point.created > 0 || point.resolved > 0);

  // The API sends ISO days; the axis is where they become human-readable.
  const points = data?.map((point) => ({
    ...point,
    date: new Date(`${point.date}T00:00:00`).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    }),
  }));

  return (
    <Card className="h-full">
      <CardHeader
        title="Incident Trend"
        // No series on screen means nothing for a legend to identify.
        action={hasData ? <ChartLegend items={legendItems} /> : undefined}
      />
      <CardBody>
        {isLoading || !data ? (
          <Skeleton className="h-[232px] w-full" />
        ) : hasData && points ? (
          <TrendChart data={points} xKey="date" series={SERIES} />
        ) : (
          <EmptyState
            className="h-[232px] py-0"
            icon={<LineChart className="size-5" />}
            title="No activity in this period"
            description="Once incidents are created and resolved, the trend appears here."
          />
        )}
      </CardBody>
    </Card>
  );
}

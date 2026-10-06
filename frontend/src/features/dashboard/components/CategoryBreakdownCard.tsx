import { useState } from 'react';
import { ChartPie } from 'lucide-react';
import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { ChartLegend, DonutChart } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { seriesPalette } from '@/theme';
import type { CategoryBreakdown } from '../types';
import { ViewAllLink } from './ViewAllLink';

/**
 * Part-to-whole across incident categories.
 *
 * The legend direct-labels every slice with its count, so the exact figures are
 * readable without hovering and the chart does not depend on colour alone.
 * Hovering either the ring or a legend row highlights the pair.
 */
export function CategoryBreakdownCard({
  data,
  total,
  isLoading,
}: {
  data?: CategoryBreakdown[];
  total?: number;
  isLoading: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);

  return (
    <Card className="h-full">
      <CardHeader title="Incidents by Category" action={<ViewAllLink to="/incidents" />} />
      <CardBody>
        {isLoading || !data ? (
          <Skeleton className="h-[180px] w-full" />
        ) : data.length === 0 ? (
          <EmptyState
            className="h-[180px] py-0"
            icon={<ChartPie className="size-5" />}
            title="No incidents yet"
            description="The category split appears once incidents are logged."
          />
        ) : (
          <div className="flex items-center gap-4">
            <DonutChart
              data={data}
              centerValue={String(total ?? data.reduce((sum, d) => sum + d.value, 0))}
              centerLabel="Total"
              size={152}
              activeKey={active}
              onActiveChange={setActive}
            />
            <div className="min-w-0 flex-1">
              <ChartLegend
                orientation="vertical"
                activeKey={active}
                onHover={setActive}
                items={data.map((d, i) => ({
                  key: d.key,
                  label: d.label,
                  color: seriesPalette[i % seriesPalette.length],
                  value: d.value,
                }))}
              />
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

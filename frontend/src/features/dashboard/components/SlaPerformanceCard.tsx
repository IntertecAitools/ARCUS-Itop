import { ShieldCheck } from 'lucide-react';
import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { ChartLegend, DonutChart } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { status } from '@/theme';
import { percent } from '@/lib/utils';
import type { SlaBreakdown } from '../types';
import { ViewAllLink } from './ViewAllLink';

/**
 * On time / at risk / breached.
 *
 * These three slices are STATES, not series — so they wear the reserved status
 * roles rather than categorical slots. That reservation is what stops a red
 * mark in the category donut beside it from reading as "breached".
 */
export function SlaPerformanceCard({
  data,
  isLoading,
}: {
  data?: SlaBreakdown;
  isLoading: boolean;
}) {
  const slices = data
    ? [
        { key: 'on_time', label: 'On Time', value: data.onTime, color: status.good },
        { key: 'at_risk', label: 'At Risk', value: data.atRisk, color: status.warning },
        { key: 'breached', label: 'Breached', value: data.breached, color: status.critical },
      ]
    : [];

  return (
    <Card className="h-full">
      <CardHeader
        title="SLA Performance"
        action={<ViewAllLink to="/sla" label="View details" />}
      />
      <CardBody>
        {isLoading || !data ? (
          <Skeleton className="h-[180px] w-full" />
        ) : data.onTime + data.atRisk + data.breached === 0 ? (
          // A donut of three zeroes draws an empty ring and a misleading "0%".
          <EmptyState
            className="h-[180px] py-0"
            icon={<ShieldCheck className="size-5" />}
            title="Nothing under SLA yet"
            description="Compliance appears once tickets are covered by a service level."
          />
        ) : (
          <div className="flex flex-col items-center gap-4">
            <DonutChart
              data={slices}
              centerValue={data.compliance === null ? '—' : percent(data.compliance)}
              centerLabel="On Track"
              size={150}
            />
            <div className="w-full">
              <ChartLegend
                orientation="vertical"
                items={slices.map((s) => ({
                  key: s.key,
                  label: s.label,
                  color: s.color,
                  value: s.value,
                }))}
              />
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

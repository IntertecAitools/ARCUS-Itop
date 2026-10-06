'use client';

import dynamic from 'next/dynamic';
import { formatShare } from '@/lib/utils';
import { chartColor, type ChartColor } from '@/theme';
import { Skeleton } from '@/components/feedback';

export interface DonutDatum {
  id: string;
  label: string;
  value: number;
  color: ChartColor;
}

// Charts are client-only.
const DonutChartImpl = dynamic(() => import('./DonutChartImpl'), {
  ssr: false,
  loading: () => <Skeleton className="size-full rounded-full" />,
});

export interface DonutChartProps {
  data: DonutDatum[];
  /** Caption under the centred total, e.g. "Total" */
  totalLabel: string;
  /** Accessible summary of the chart */
  ariaLabel: string;
}

export function DonutChart({ data, totalLabel, ariaLabel }: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row">
      <figure className="relative size-40 shrink-0" role="img" aria-label={ariaLabel}>
        <DonutChartImpl data={data} />
        <figcaption className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-text">{total}</span>
          <span className="text-xs text-text-muted">{totalLabel}</span>
        </figcaption>
      </figure>
      <ul className="w-full min-w-0 space-y-2.5">
        {data.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-text">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: chartColor[d.color] }} aria-hidden />
              {d.label}
            </span>
            <span className="whitespace-nowrap text-text-muted">
              <span className="font-semibold text-text">{d.value}</span> ({formatShare(d.value, total)})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

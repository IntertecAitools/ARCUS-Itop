'use client';

import dynamic from 'next/dynamic';
import { chartColor, type ChartColor } from '@/theme';
import { Skeleton } from '@/components/feedback';

export interface TrendSeries {
  key: string;
  label: string;
  color: ChartColor;
}

export type TrendDatum = { label: string } & Record<string, number | string>;

export interface TrendChartProps {
  data: TrendDatum[];
  series: TrendSeries[];
  ariaLabel: string;
  height?: number;
}

// Charts are client-only.
const TrendChartImpl = dynamic(() => import('./TrendChartImpl'), {
  ssr: false,
  loading: () => <Skeleton className="size-full" />,
});

export function TrendChart({ data, series, ariaLabel, height = 260 }: TrendChartProps) {
  return (
    <figure className="space-y-3">
      <div style={{ height }} role="img" aria-label={ariaLabel}>
        <TrendChartImpl data={data} series={series} />
      </div>
      <figcaption>
        <ul className="flex flex-wrap justify-center gap-5 text-sm text-text-muted">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-2">
              <span className="size-2.5 rounded-full" style={{ backgroundColor: chartColor[s.color] }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      </figcaption>
    </figure>
  );
}

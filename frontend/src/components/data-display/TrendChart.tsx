import { useId } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { axisTickStyle, chartChrome, seriesPalette } from '@/theme';
import { ChartTooltip } from './ChartTooltip';

export interface TrendSeries {
  /** Must match a key on every row of `data`. */
  key: string;
  label: string;
  /** Fill under the line. Use for at most one series — stacked washes muddy. */
  filled?: boolean;
}

interface TrendChartProps<T extends object> {
  data: T[];
  /** X-axis field. */
  xKey: keyof T & string;
  /**
   * Series in a FIXED order. Slot 0 gets series-1, slot 1 gets series-2 …
   * Colour follows the entity, so hiding a series never repaints the others.
   */
  series: TrendSeries[];
  height?: number;
}

/**
 * Change over time, on ONE y-axis.
 *
 * Never add a second y-scale here. Two measures of different magnitude become
 * two charts, small multiples, or both indexed to a common base — a dual axis
 * lets the author put any two lines anywhere relative to each other.
 */
export function TrendChart<T extends object>({
  data,
  xKey,
  series,
  height = 232,
}: TrendChartProps<T>) {
  const gradientPrefix = useId();

  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient
              key={s.key}
              id={`${gradientPrefix}-${s.key}`}
              x1="0"
              y1="0"
              x2="0"
              y2="1"
            >
              <stop offset="0%" stopColor={seriesPalette[i]} stopOpacity={0.16} />
              <stop offset="100%" stopColor={seriesPalette[i]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>

        {/* Horizontal rules only, hairline weight — the grid must stay recessive. */}
        <CartesianGrid stroke={chartChrome.grid} strokeWidth={1} vertical={false} />

        <XAxis
          dataKey={xKey}
          tick={axisTickStyle}
          tickLine={false}
          axisLine={{ stroke: chartChrome.grid }}
          tickMargin={10}
          minTickGap={16}
        />
        <YAxis
          tick={axisTickStyle}
          tickLine={false}
          axisLine={false}
          width={44}
          allowDecimals={false}
        />

        <Tooltip
          content={<ChartTooltip />}
          cursor={{ stroke: chartChrome.axis, strokeWidth: 1, strokeDasharray: '3 3' }}
        />

        {series.map((s, i) =>
          s.filled ? (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={seriesPalette[i]}
              strokeWidth={2}
              fill={`url(#${gradientPrefix}-${s.key})`}
              dot={{ r: 3, fill: seriesPalette[i], strokeWidth: 0 }}
              activeDot={{ r: 5, stroke: chartChrome.surface, strokeWidth: 2 }}
              // Growth animation delays the real reading and fights
              // prefers-reduced-motion; the data should be there on first paint.
              isAnimationActive={false}
            />
          ) : (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={seriesPalette[i]}
              strokeWidth={2}
              dot={{ r: 3, fill: seriesPalette[i], strokeWidth: 0 }}
              activeDot={{ r: 5, stroke: chartChrome.surface, strokeWidth: 2 }}
              // Growth animation delays the real reading and fights
              // prefers-reduced-motion; the data should be there on first paint.
              isAnimationActive={false}
            />
          ),
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

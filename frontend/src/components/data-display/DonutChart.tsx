import { useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { chartChrome, seriesPalette } from '@/theme';
import { ChartTooltip } from './ChartTooltip';

export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  /** Override the slot colour — used when a slice must wear a status role. */
  color?: string;
}

interface DonutChartProps {
  data: DonutSlice[];
  /** Big number in the hole. Omit for a plain ring. */
  centerValue?: string;
  centerLabel?: string;
  size?: number;
  activeKey?: string | null;
  onActiveChange?: (key: string | null) => void;
}

/**
 * Part-to-whole. Caps at the eight categorical slots — the caller folds the
 * tail into an "Others" slice rather than generating a ninth hue.
 *
 * Segments are separated by a 2px ring in the SURFACE colour, so adjacent
 * slices read as distinct marks instead of one continuous band.
 */
export function DonutChart({
  data,
  centerValue,
  centerLabel,
  size = 180,
  activeKey,
  onActiveChange,
}: DonutChartProps) {
  const [internalActive, setInternalActive] = useState<string | null>(null);
  const active = activeKey !== undefined ? activeKey : internalActive;

  const setActive = (key: string | null) => {
    if (onActiveChange) onActiveChange(key);
    else setInternalActive(key);
  };

  const colorFor = (slice: DonutSlice, index: number) =>
    slice.color ?? seriesPalette[index % seriesPalette.length];

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip content={<ChartTooltip />} />
          <Pie
            data={data}
            dataKey="value"
            nameKey="label"
            innerRadius="66%"
            outerRadius="100%"
            paddingAngle={1}
            startAngle={90}
            endAngle={-270}
            stroke={chartChrome.surface}
            strokeWidth={2}
            isAnimationActive={false}
            onMouseEnter={(_, index) => setActive(data[index]?.key ?? null)}
            onMouseLeave={() => setActive(null)}
          >
            {data.map((slice, index) => (
              <Cell
                key={slice.key}
                fill={colorFor(slice, index)}
                opacity={active && active !== slice.key ? 0.35 : 1}
              />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>

      {centerValue ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl leading-7 font-semibold text-ink">{centerValue}</span>
          {centerLabel ? (
            <span className="mt-0.5 text-[11px] text-ink-muted">{centerLabel}</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

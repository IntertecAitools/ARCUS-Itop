'use client';

import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { chartColor } from '@/theme';
import type { TrendChartProps } from './TrendChart';

export default function TrendChartImpl({ data, series }: Pick<TrendChartProps, 'data' | 'series'>) {
  const gradientPrefix = useId().replace(/:/g, '');
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`${gradientPrefix}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={chartColor[s.color]} stopOpacity={0.22} />
              <stop offset="100%" stopColor={chartColor[s.color]} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={chartColor.grid} strokeDasharray="4 4" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: chartColor.muted, fontSize: 12 }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: chartColor.muted, fontSize: 12 }} />
        <Tooltip
          contentStyle={{
            borderRadius: 10,
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-popover)',
            fontSize: 12,
          }}
        />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={chartColor[s.color]}
            strokeWidth={2.5}
            fill={`url(#${gradientPrefix}-${s.key})`}
            dot={{ r: 3, strokeWidth: 2, fill: chartColor.surface }}
            activeDot={{ r: 5 }}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

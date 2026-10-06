'use client';

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { chartColor } from '@/theme';
import type { DonutDatum } from './DonutChart';

export default function DonutChartImpl({ data }: { data: DonutDatum[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="label"
          innerRadius="68%"
          outerRadius="100%"
          paddingAngle={data.filter((d) => d.value > 0).length > 1 ? 2 : 0}
          stroke="none"
          isAnimationActive={false}
        >
          {data.map((d) => (
            <Cell key={d.id} fill={chartColor[d.color]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={{
            borderRadius: 10,
            border: '1px solid var(--color-border)',
            boxShadow: 'var(--shadow-popover)',
            fontSize: 12,
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

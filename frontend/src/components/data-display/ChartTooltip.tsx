import type { TooltipProps } from 'recharts';

/**
 * One tooltip shape for every chart in the app.
 *
 * Values and labels wear TEXT tokens, never the series colour — the swatch
 * beside each row carries identity, the text stays legible ink.
 */
export function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null;

  return (
    <div className="rounded-control border border-line bg-surface-raised px-3 py-2 shadow-overlay">
      {label ? (
        <p className="mb-1.5 text-[11px] font-medium text-ink-muted">{String(label)}</p>
      ) : null}
      <ul className="space-y-1">
        {payload.map((entry) => (
          <li key={String(entry.dataKey ?? entry.name)} className="flex items-center gap-2 text-xs">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ background: entry.color }}
              aria-hidden
            />
            <span className="text-ink-secondary">{entry.name}</span>
            <span className="ml-auto pl-3 font-semibold text-ink tabular-nums">{entry.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface LegendItem {
  key: string;
  label: string;
  color: string;
  value?: string | number;
}

/**
 * A legend is ALWAYS present for two or more series. With four or fewer the
 * chart also direct-labels, so identity never rests on colour alone.
 */
export function ChartLegend({
  items,
  orientation = 'horizontal',
  activeKey,
  onHover,
}: {
  items: LegendItem[];
  orientation?: 'horizontal' | 'vertical';
  activeKey?: string | null;
  onHover?: (key: string | null) => void;
}) {
  return (
    <ul
      className={
        orientation === 'horizontal'
          ? 'flex flex-wrap items-center gap-x-4 gap-y-1'
          : 'space-y-2.5'
      }
    >
      {items.map((item) => {
        const dimmed = activeKey != null && activeKey !== item.key;
        return (
          <li
            key={item.key}
            onMouseEnter={() => onHover?.(item.key)}
            onMouseLeave={() => onHover?.(null)}
            className={`flex items-center gap-2 text-[13px] transition-opacity duration-150 ${
              dimmed ? 'opacity-40' : 'opacity-100'
            }`}
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ background: item.color }}
              aria-hidden
            />
            <span className="min-w-0 truncate text-ink-secondary">{item.label}</span>
            {item.value !== undefined ? (
              <span className="ml-auto shrink-0 pl-3 font-semibold text-ink tabular-nums">
                {item.value}
              </span>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

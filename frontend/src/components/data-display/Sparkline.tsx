import { useId, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';

export interface SparklinePoint {
  label: string;
  value: number;
}

interface SparklineProps {
  data: SparklinePoint[];
  /** A CSS colour token — pass a `var(--arcus-…)` reference, never a hex. */
  color: string;
  /** Bars read better for discrete counts; the line for a continuous measure. */
  variant?: 'line' | 'bars';
  width?: number;
  height?: number;
  className?: string;
  /** Names the trend for screen readers, e.g. "Total incidents, last 7 days". */
  ariaLabel: string;
}

/**
 * The micro-chart inside a KPI tile. It carries shape, not precise values — no
 * axes, no gridlines, no labels. Hovering reveals the exact figure, so the tile
 * is still interrogable; the sparkline itself stays silent.
 */
export function Sparkline({
  data,
  color,
  variant = 'line',
  width = 112,
  height = 40,
  className,
  ariaLabel,
}: SparklineProps) {
  const gradientId = useId();
  const [hover, setHover] = useState<number | null>(null);

  const { points, path, areaPath, min, max, barWidth, band } = useMemo(() => {
    // Math.min() of an empty list is Infinity, which would produce NaN geometry.
    if (data.length === 0) {
      return { points: [], path: '', areaPath: '', min: 0, max: 0, barWidth: 2, band: width };
    }
    const values = data.map((d) => d.value);
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    // A flat series would divide by zero; give it a nominal band so it renders
    // as a centred straight line rather than collapsing onto the baseline.
    const span = hi - lo || 1;
    const padY = 4;
    // Inset horizontally too: a 2px stroke and the 3.5px hover dot are centred
    // on the point, so an un-inset first/last point bleeds past the card edge.
    const padX = 5;
    const usableH = height - padY * 2;
    const usableW = width - padX * 2;
    const step = data.length > 1 ? usableW / (data.length - 1) : 0;

    const pts = data.map((d, i) => ({
      x: data.length > 1 ? padX + i * step : width / 2,
      y: padY + usableH - ((d.value - lo) / span) * usableH,
      ...d,
    }));

    const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
    const area = `${line} L${pts[pts.length - 1]?.x ?? 0},${height} L${pts[0]?.x ?? 0},${height} Z`;

    return {
      points: pts,
      path: line,
      areaPath: area,
      min: lo,
      max: hi,
      // Bars are sized from the INSET width so the first and last don't bleed
      // past the edge; `band` is the per-point hit-strip width.
      barWidth: data.length ? Math.max(2, usableW / data.length - 2) : 2,
      band: data.length ? usableW / data.length : usableW,
    };
  }, [data, width, height]);

  const active = hover !== null ? points[hover] : null;

  if (data.length === 0) return null;

  return (
    <div className={cn('relative', className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`${ariaLabel}. Low ${min}, high ${max}.`}
        className="overflow-visible"
        onMouseLeave={() => setHover(null)}
      >
        {variant === 'line' ? (
          <>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity="0.18" />
                <stop offset="100%" stopColor={color} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${gradientId})`} />
            <path
              d={path}
              fill="none"
              stroke={color}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {active ? (
              <circle
                cx={active.x}
                cy={active.y}
                r={3.5}
                fill={color}
                stroke="var(--arcus-surface)"
                strokeWidth={2}
              />
            ) : null}
          </>
        ) : (
          points.map((p, i) => (
            <rect
              key={p.label}
              x={p.x - barWidth / 2}
              y={p.y}
              width={barWidth}
              height={Math.max(2, height - p.y)}
              rx={2}
              fill={color}
              opacity={hover === null || hover === i ? 0.9 : 0.35}
            />
          ))
        )}

        {/* Invisible hit strips — a 2px line is far too thin to aim at. */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.label}`}
            x={p.x - band / 2}
            y={0}
            width={band}
            height={height}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}
      </svg>

      {active ? (
        <div
          role="tooltip"
          style={{ left: active.x, transform: 'translate(-50%, -100%)' }}
          className="pointer-events-none absolute -top-1 z-10 rounded-control border border-line bg-surface-raised px-2 py-1 text-[11px] whitespace-nowrap shadow-raised"
        >
          <span className="text-ink-muted">{active.label}</span>{' '}
          <span className="font-semibold text-ink tabular-nums">{active.value}</span>
        </div>
      ) : null}
    </div>
  );
}

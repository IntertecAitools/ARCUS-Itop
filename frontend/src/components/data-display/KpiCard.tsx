import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Sparkline, type SparklinePoint } from './Sparkline';

/**
 * Whether the movement is GOOD or BAD is a judgement about the metric, not
 * about the arrow direction — "SLA breaches down 3%" is good news even though
 * the arrow points down. The caller decides; the tile just renders.
 */
export type DeltaIntent = 'positive' | 'negative' | 'neutral';

export type KpiTone = 'brand' | 'critical' | 'warning' | 'good';

export interface KpiCardProps {
  label: string;
  /** The hero figure. Pre-formatted, so the tile stays unit-agnostic (248, 91%). */
  value: string;
  icon: ReactNode;
  tone?: KpiTone;
  delta?: {
    /** Pre-formatted magnitude, e.g. "12%". The arrow carries the sign. */
    value: string;
    direction: 'up' | 'down' | 'flat';
    intent: DeltaIntent;
    /** Names the comparison period — a delta without a baseline is meaningless. */
    comparedTo?: string;
  };
  trend?: SparklinePoint[];
  className?: string;
}

const iconToneClasses: Record<KpiTone, string> = {
  brand: 'bg-brand-soft text-brand',
  critical: 'bg-critical-soft text-critical',
  warning: 'bg-warning-soft text-warning',
  good: 'bg-good-soft text-good',
};

const sparkColor: Record<KpiTone, string> = {
  brand: 'var(--arcus-brand)',
  critical: 'var(--arcus-critical)',
  warning: 'var(--arcus-warning)',
  good: 'var(--arcus-good)',
};

const deltaIntentClasses: Record<DeltaIntent, string> = {
  positive: 'text-good-ink',
  negative: 'text-critical-ink',
  neutral: 'text-ink-muted',
};

const DeltaIcon = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

export function KpiCard({
  label,
  value,
  icon,
  tone = 'brand',
  delta,
  trend,
  className,
}: KpiCardProps) {
  const Arrow = delta ? DeltaIcon[delta.direction] : null;

  return (
    <div
      className={cn(
        'rounded-card border border-line bg-surface p-4 shadow-card',
        'transition-shadow duration-200 hover:shadow-raised',
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={cn(
            'flex size-11 shrink-0 items-center justify-center rounded-control',
            iconToneClasses[tone],
          )}
          aria-hidden
        >
          {icon}
        </span>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink-secondary">{label}</p>

          {/* Hero figure and sparkline share a row; the delta gets its own full
              row underneath so "vs last week" never wraps against the chart. */}
          <div className="mt-0.5 flex items-end justify-between gap-3">
            {/* Hero figures use proportional figures — they do not align in a column. */}
            <p className="text-[28px] leading-9 font-semibold tracking-tight text-ink">{value}</p>

            {trend?.length ? (
              <Sparkline
                data={trend}
                color={sparkColor[tone]}
                variant={tone === 'brand' ? 'bars' : 'line'}
                width={92}
                height={34}
                ariaLabel={`${label} trend`}
                className="shrink-0"
              />
            ) : null}
          </div>

          {delta && Arrow ? (
            <p
              className={cn(
                'mt-0.5 flex items-center gap-1 text-[12.5px] font-medium',
                deltaIntentClasses[delta.intent],
              )}
            >
              <Arrow className="size-3.5 shrink-0" aria-hidden />
              <span className="tabular-nums">{delta.value}</span>
              {delta.comparedTo ? (
                <span className="truncate font-normal text-ink-muted">{delta.comparedTo}</span>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { accentBubbleClasses, type AccentTone } from '@/theme';
import { Skeleton } from '@/components/feedback';

export interface KpiTrend {
  /** Percentage change vs the previous period; null when there is no baseline */
  value: number | null;
  /** Direction that counts as good news (green) */
  goodWhen: 'up' | 'down';
}

export interface KpiCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  tone?: AccentTone;
  trend?: KpiTrend;
  /** e.g. "vs last week" */
  trendCaption?: string;
  loading?: boolean;
  className?: string;
}

function TrendLine({ trend, caption }: { trend: KpiTrend; caption?: string }) {
  if (trend.value === null) {
    return <p className="text-xs text-text-muted">{caption}</p>;
  }
  const up = trend.value > 0;
  const flat = trend.value === 0;
  const good = flat || (up ? trend.goodWhen === 'up' : trend.goodWhen === 'down');
  const arrow = flat ? '→' : up ? '↑' : '↓';
  const sign = up ? '+' : '';
  return (
    <p className="text-xs text-text-muted">
      <span className={cn('font-semibold', flat ? 'text-text-muted' : good ? 'text-success' : 'text-danger')}>
        {arrow} {sign}
        {trend.value}%
      </span>{' '}
      {caption}
    </p>
  );
}

export function KpiCard({ label, value, icon: Icon, tone = 'primary', trend, trendCaption, loading, className }: KpiCardProps) {
  return (
    <div className={cn('flex items-center gap-4 rounded-card border border-border bg-surface p-5 shadow-card', className)}>
      <span className={cn('flex size-14 shrink-0 items-center justify-center rounded-full', accentBubbleClasses[tone])} aria-hidden>
        <Icon className="size-6" />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="truncate text-sm text-text-muted">{label}</p>
        {loading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <p className="text-[28px] leading-8 font-bold text-text">{value}</p>
        )}
        {trend && !loading && <TrendLine trend={trend} caption={trendCaption} />}
      </div>
    </div>
  );
}

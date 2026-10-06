'use client';

import Link from 'next/link';
import { useTranslation } from 'react-i18next';
import { CircleCheckBig, Lightbulb, TriangleAlert, UserX } from 'lucide-react';
import { Card, DonutChart, KpiCard, TrendChart, type DonutDatum } from '@/components/data-display';
import { EmptyState, Skeleton } from '@/components/feedback';
import { Select } from '@/components/ui';
import { routes } from '@/config';
import { useCurrentUser } from '@/features/auth';
import { percentChange } from '@/lib/utils';
import type { ChartColor } from '@/theme';
import { useProblemStats, useProblems } from '../api/problems';
import { PROBLEM_PRIORITIES } from '../schemas';
import type { KpiValue, ProblemPriority, ProblemStats, StatsRange } from '../types';
import { ProblemPriorityBadge } from './ProblemBadges';
import { ProblemTable } from './ProblemTable';

const RANGES: StatsRange[] = ['7d', '30d', '90d'];

function trend(kpi: KpiValue | undefined, goodWhen: 'up' | 'down') {
  return kpi ? { value: percentChange(kpi.value, kpi.previous), goodWhen } : undefined;
}

/** The four KPI cards. Exported so features/dashboard can reuse them. */
export function ProblemKpis() {
  const { t } = useTranslation('problems');
  const { data, isLoading } = useProblemStats('7d');
  const k = data?.kpis;
  const caption = t('dashboard.vsLastWeek');
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <KpiCard
        label={t('dashboard.kpi.open')}
        value={k?.open.value ?? 0}
        icon={TriangleAlert}
        tone="primary"
        trend={trend(k?.open, 'down')}
        trendCaption={caption}
        loading={isLoading}
      />
      <KpiCard
        label={t('dashboard.kpi.unassigned')}
        value={k?.unassigned.value ?? 0}
        icon={UserX}
        tone="danger"
        trend={trend(k?.unassigned, 'down')}
        trendCaption={caption}
        loading={isLoading}
      />
      <KpiCard
        label={t('dashboard.kpi.resolvedThisWeek')}
        value={k?.resolvedThisWeek.value ?? 0}
        icon={CircleCheckBig}
        tone="success"
        trend={trend(k?.resolvedThisWeek, 'up')}
        trendCaption={caption}
        loading={isLoading}
      />
      <KpiCard
        label={t('dashboard.kpi.knownErrors')}
        value={k?.knownErrors.value ?? 0}
        icon={Lightbulb}
        tone="purple"
        trend={trend(k?.knownErrors, 'up')}
        trendCaption={caption}
        loading={isLoading}
      />
    </div>
  );
}

function RangeSelect({ id, value, onChange }: { id: string; value: StatsRange; onChange: (r: StatsRange) => void }) {
  const { t } = useTranslation('problems');
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {t('dashboard.range.label')}
      </label>
      <Select
        id={id}
        className="w-36"
        value={value}
        onChange={(e) => onChange(e.target.value as StatsRange)}
        options={RANGES.map((r) => ({ value: r, label: t(`dashboard.range.${r}`) }))}
      />
    </>
  );
}

function seriesLabel(date: string, range: StatsRange): string {
  const d = new Date(date);
  return range === '7d'
    ? new Intl.DateTimeFormat('en-GB', { weekday: 'short' }).format(d)
    : new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(d);
}

export function ProblemsTrendCard({ range, onRangeChange }: { range: StatsRange; onRangeChange: (r: StatsRange) => void }) {
  const { t } = useTranslation('problems');
  const { data, isLoading } = useProblemStats(range);
  const rows = (data?.series ?? []).map((p) => ({ label: seriesLabel(p.date, range), created: p.created, resolved: p.resolved }));
  const created = rows.reduce((s, r) => s + r.created, 0);
  const resolved = rows.reduce((s, r) => s + r.resolved, 0);
  return (
    <Card title={t('dashboard.trendTitle')} actions={<RangeSelect id="trend-range" value={range} onChange={onRangeChange} />}>
      {isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <TrendChart
          data={rows}
          ariaLabel={t('dashboard.trendAria', { created, resolved, range: t(`dashboard.range.${range}`) })}
          series={[
            { key: 'created', label: t('dashboard.created'), color: 'primary' },
            { key: 'resolved', label: t('dashboard.resolved'), color: 'success' },
          ]}
        />
      )}
    </Card>
  );
}

const PRIORITY_COLORS: Record<ProblemPriority, ChartColor> = { '1': 'danger', '2': 'orange', '3': 'yellow', '4': 'primary' };

export function PriorityDonutCard({ range }: { range: StatsRange }) {
  const { t } = useTranslation('problems');
  const { data, isLoading } = useProblemStats(range);
  const byPriority = new Map((data?.byPriority ?? []).map((p) => [p.priority, p.count]));
  const donut: DonutDatum[] = PROBLEM_PRIORITIES.map((p) => ({
    id: p,
    label: t(`priority.${p}`),
    value: byPriority.get(p) ?? 0,
    color: PRIORITY_COLORS[p],
  }));
  return (
    <Card title={t('dashboard.byPriorityTitle')}>
      {isLoading ? (
        <Skeleton className="h-44 w-full" />
      ) : (
        <DonutChart
          data={donut}
          totalLabel={t('dashboard.total')}
          ariaLabel={t('dashboard.byPriorityAria', {
            summary: donut.map((d) => `${d.label} ${d.value}`).join(', '),
          })}
        />
      )}
    </Card>
  );
}

export function RecentProblemsCard() {
  const { t } = useTranslation('problems');
  const { data, isLoading } = useProblems({ sort: '-start_date', page: 1, pageSize: 5 });
  return (
    <Card title={t('dashboard.recentTitle')} viewAllHref={routes.problems.list()} viewAllLabel={t('dashboard.viewAll')}>
      <ProblemTable compact rows={data?.items ?? []} loading={isLoading} />
    </Card>
  );
}

export function MyProblemsCard() {
  const { t } = useTranslation('problems');
  const user = useCurrentUser();
  const { data, isLoading } = useProblems(
    { agentId: user?.personId, status: ['new', 'assigned'], sort: 'priority', page: 1, pageSize: 5 },
    { enabled: !!user },
  );
  const items = data?.items ?? [];
  return (
    <Card
      title={t('dashboard.myTitle')}
      viewAllHref={routes.problems.list({ tab: 'mine' })}
      viewAllLabel={t('dashboard.viewAll')}
    >
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t('dashboard.myEmpty')} className="py-6" />
      ) : (
        <ul className="divide-y divide-border">
          {items.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <Link href={routes.problems.detail(p.id)} className="text-sm font-medium text-link hover:underline">
                  {p.ref}
                </Link>
                <p className="truncate text-sm text-text-muted">{p.title}</p>
              </div>
              <span className="shrink-0">
                <ProblemPriorityBadge priority={p.priority} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function TopServicesCard({ range }: { range: StatsRange }) {
  const { t } = useTranslation('problems');
  const { data, isLoading } = useProblemStats(range);
  const services: ProblemStats['topServices'] = data?.topServices ?? [];
  const max = Math.max(1, ...services.map((s) => s.count));
  return (
    <Card title={t('dashboard.topServicesTitle')} viewAllHref={routes.problems.list()} viewAllLabel={t('dashboard.viewAll')}>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : services.length === 0 ? (
        <EmptyState title={t('dashboard.topServicesEmpty')} className="py-6" />
      ) : (
        <ul className="space-y-3.5">
          {services.map((s) => (
            <li key={s.service_id}>
              <Link
                href={routes.problems.list({ serviceId: s.service_id })}
                className="group block"
                aria-label={t('dashboard.serviceCount', { name: s.service_name, count: s.count })}
              >
                <div className="mb-1 flex justify-between text-sm">
                  <span className="text-text group-hover:text-link">{s.service_name}</span>
                  <span className="font-semibold text-text">{s.count}</span>
                </div>
                <div className="h-2 rounded-full bg-neutral-soft" aria-hidden>
                  <div className="h-2 rounded-full bg-primary" style={{ width: `${(s.count / max) * 100}%` }} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

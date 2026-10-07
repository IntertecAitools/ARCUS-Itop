import { CalendarDays } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Select } from '@/components/ui';
import { greeting, longDate } from '@/lib/utils';
import { useSessionStore } from '@/stores/session.store';
import { useDashboardOverview } from '../api/useDashboardOverview';
import { useDateRange } from '../hooks/useDateRange';
import type { DateRange } from '../types';
import {
  CategoryBreakdownCard,
  ChangeCalendarCard,
  IncidentTrendCard,
  KnowledgeArticlesCard,
  KpiRow,
  MyAssignmentsCard,
  RecentIncidentsCard,
  ServiceRequestShortcuts,
  SlaPerformanceCard,
} from '../components';

/**
 * Agent home.
 *
 * This page is also the reference implementation of the theme: it is the one
 * screen that uses every shared piece (KPI tiles, both chart forms, the table,
 * tabs, the calendar, the empty states). When you build a new module, copy the
 * composition pattern from here rather than inventing a new one.
 *
 * Layout reads top-down in order of urgency: headline numbers, then trends,
 * then the work you personally have to do, then the things you might want.
 */
export function DashboardPage() {
  const user = useSessionStore((s) => s.user);
  const { range, setRange, options } = useDateRange();
  const { data, isLoading, isError, error } = useDashboardOverview(range);

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Dashboard' }]}
        title={`${greeting()}, ${user?.name ?? 'there'}`}
        description="Here's an overview of your IT operations."
        actions={
          <>
            {/* The date control sits in ONE row above the cards — never repeated
                per card, so there is never a question of what a chart is scoped to. */}
            <span className="inline-flex h-9 items-center gap-2 rounded-control border border-line-strong bg-surface px-3 text-[13px] text-ink-secondary">
              <CalendarDays className="size-4 text-ink-muted" aria-hidden />
              {longDate(new Date())}
            </span>
            <Select
              aria-label="Date range"
              className="w-40"
              value={range}
              onChange={(e) => setRange(e.target.value as DateRange)}
              options={options.map((o) => ({ value: o.value, label: o.label }))}
            />
          </>
        }
      />

      {isError ? (
        <div
          role="alert"
          className="mb-6 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
        >
          Couldn’t load the dashboard. {error instanceof Error ? error.message : ''}
        </div>
      ) : null}

      <div className="space-y-4">
        <KpiRow kpis={data?.kpis} range={range} isLoading={isLoading} />

        {/* Trend gets two thirds of the row; the two part-to-whole cards share
            the rest — a donut needs far less width than a time series. */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-5">
            <IncidentTrendCard data={data?.trend} isLoading={isLoading} />
          </div>
          {/* The category donut needs room for a direct-labelled legend beside
              it; the SLA card stacks its legend, so it can take the narrow slot. */}
          <div className="xl:col-span-4">
            <CategoryBreakdownCard
              data={data?.categories}
              total={data?.kpis.totalIncidents}
              isLoading={isLoading}
            />
          </div>
          <div className="xl:col-span-3">
            <SlaPerformanceCard data={data?.sla} isLoading={isLoading} />
          </div>
        </div>

        {/* Recent Incidents carries two more columns than My Assignments, so it
            gets the wider slot — an even split starves its Summary column. */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-7">
            <RecentIncidentsCard data={data?.recentIncidents} isLoading={isLoading} />
          </div>
          <div className="xl:col-span-5">
            <MyAssignmentsCard data={data?.myAssignments} isLoading={isLoading} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <div className="xl:col-span-5">
            <ServiceRequestShortcuts data={data?.catalogShortcuts} isLoading={isLoading} />
          </div>
          <div className="xl:col-span-4">
            <ChangeCalendarCard data={data?.changeCalendar} isLoading={isLoading} />
          </div>
          <div className="xl:col-span-3">
            <KnowledgeArticlesCard data={data?.knowledgeArticles} isLoading={isLoading} />
          </div>
        </div>
      </div>
    </>
  );
}

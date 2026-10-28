import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlarmClock, CircleCheck, CircleSlash, Siren, X } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Badge, Button, Card, CardBody, CardHeader, Select, Skeleton } from '@/components/ui';
import { DataTable, type Column } from '@/components/data-display';
import { isModuleRegistered } from '@/config/modules';
import { cn, friendlyDateTime } from '@/lib/utils';
import { useSlaDashboard, useSlaTickets } from '../api/useSla';
import { SlaBreakdownCard } from '../components/SlaBreakdownCard';
import {
  drillDownTitle,
  isDrilledDown,
  metricText,
  metricTone,
  paramsFromQuery,
  PRIORITY_LABELS,
  queryFromParams,
  stateMeta,
  STATES,
  ticketHref,
  TYPES,
} from '../lib/sla';
import type { SlaMetric, SlaState, SlaTicket, SlaTicketQuery, SlaTicketType } from '../types';

const ICONS: Record<SlaState, typeof Siren> = {
  breached: Siren,
  at_risk: AlarmClock,
  within: CircleCheck,
  none: CircleSlash,
};

const TILE_TONE: Record<SlaState, string> = {
  breached: 'bg-critical-soft text-critical',
  at_risk: 'bg-warning-soft text-warning',
  within: 'bg-good-soft text-good',
  none: 'bg-surface-sunken text-ink-muted',
};

function StateTile({
  state,
  value,
  total,
  active,
  onClick,
}: {
  state: SlaState;
  value: number | undefined;
  total: number | undefined;
  active: boolean;
  onClick: () => void;
}) {
  const meta = stateMeta(state);
  const Icon = ICONS[state];
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex items-start gap-3 rounded-card border bg-surface p-4 text-left shadow-card transition-shadow hover:shadow-raised',
        active ? 'border-brand' : 'border-line',
      )}
    >
      <span className={cn('flex size-11 shrink-0 items-center justify-center rounded-control', TILE_TONE[state])} aria-hidden>
        <Icon className="size-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-medium text-ink-secondary">{meta.label}</span>
        <span className="block text-[28px] leading-9 font-semibold tracking-tight text-ink">{value ?? '–'}</span>
        {total ? (
          <span className="block text-[12px] text-ink-muted">{Math.round(((value ?? 0) / total) * 100)}% of open</span>
        ) : null}
      </span>
    </button>
  );
}

function MetricBadge({ label, metric }: { label: string; metric: SlaMetric }) {
  const due = metric.deadline ? ` · due ${friendlyDateTime(metric.deadline)}` : '';
  return (
    <span className="flex items-center gap-1.5" title={`${label}: ${metricText(metric)}${due}`}>
      <span className="w-7 text-[11px] font-medium text-ink-muted">{label}</span>
      <Badge tone={metricTone(metric)} size="sm">
        {metricText(metric)}
      </Badge>
    </span>
  );
}

function columns(incidentsRegistered: boolean): Column<SlaTicket>[] {
  return [
    {
      id: 'ref',
      header: 'Ticket',
      accessorKey: 'ref',
      size: 260,
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <Link
            to={ticketHref(row.original, incidentsRegistered)}
            className="font-medium text-brand-ink hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {row.original.ref}
          </Link>
          <span className="truncate text-[12px] text-ink-secondary">{row.original.title}</span>
        </span>
      ),
    },
    {
      id: 'state',
      header: 'SLA',
      accessorKey: 'state',
      size: 110,
      cell: ({ row }) => {
        const meta = stateMeta(row.original.state);
        return (
          <Badge tone={meta.tone} dot size="sm">
            {meta.label}
          </Badge>
        );
      },
    },
    {
      id: 'stopwatches',
      header: 'TTO / TTR',
      enableSorting: false,
      size: 200,
      cell: ({ row }) => (
        <span className="flex flex-col gap-1">
          <MetricBadge label="TTO" metric={row.original.tto} />
          <MetricBadge label="TTR" metric={row.original.ttr} />
        </span>
      ),
    },
    {
      id: 'priority',
      header: 'Priority',
      accessorKey: 'priority',
      size: 90,
      cell: ({ getValue }) => PRIORITY_LABELS[getValue() as string] ?? '–',
    },
    {
      id: 'team',
      header: 'Team / agent',
      accessorKey: 'teamName',
      size: 160,
      cell: ({ row }) => (
        <span className="flex flex-col">
          <span className={row.original.teamName ? 'text-ink' : 'text-ink-muted'}>{row.original.teamName || 'No team'}</span>
          {row.original.agentName ? <span className="text-[12px] text-ink-secondary">{row.original.agentName}</span> : null}
        </span>
      ),
    },
    { id: 'customer', header: 'Customer', accessorKey: 'orgName', size: 150 },
    { id: 'status', header: 'Status', accessorKey: 'status', size: 100 },
  ];
}

/**
 * Open incidents and requests against their SLAs: within target, at risk
 * (75%+ of a TTO or TTR target used) or breached, overall and per team,
 * priority and customer. Every count opens the tickets behind it; the
 * drill-down lives in the URL.
 */
export function SlaDashboardPage() {
  const [params, setParams] = useSearchParams();
  const query = useMemo(() => queryFromParams(params), [params]);
  const drilled = isDrilledDown(query);
  const dashboard = useSlaDashboard(query.type);
  const tickets = useSlaTickets(query, drilled);
  const data = dashboard.data;
  const incidentsRegistered = isModuleRegistered('/incidents');
  const cols = useMemo(() => columns(incidentsRegistered), [incidentsRegistered]);

  const go = (next: SlaTicketQuery) => setParams(paramsFromQuery(next));
  /** Picking from a breakdown replaces the drill-down; the ticket type stays. */
  const pick = (dimension: 'team' | 'priority' | 'org') => (key: string, state?: SlaState) =>
    go({ type: query.type, state, [dimension]: dimension === 'team' && key === '' ? 'none' : key });
  const selectedTeam = query.team === 'none' ? '' : query.team;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'SLA dashboard' }]}
        title="SLA dashboard"
        description={
          data
            ? `Open tickets against their TTO and TTR targets. At risk from ${data.atRiskPercent}% of a target used. Updated ${friendlyDateTime(data.generatedAt)}.`
            : 'Open tickets against their TTO and TTR targets.'
        }
        actions={
          <Select
            aria-label="Tickets"
            className="w-56"
            value={query.type}
            onChange={(e) => go({ ...query, type: e.target.value as SlaTicketType })}
            options={TYPES}
          />
        }
      />

      {dashboard.isError ? (
        <div role="alert" className="mb-6 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load the SLA dashboard. {dashboard.error instanceof Error ? dashboard.error.message : ''}
        </div>
      ) : null}

      {data?.truncated ? (
        <div role="status" className="mb-4 rounded-card border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-ink">
          More open tickets than the dashboard reads in one go: the counts cover the first ones only.
        </div>
      ) : null}

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {dashboard.isLoading || !data
          ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[104px]" />)
          : STATES.map((s) => (
              <StateTile
                key={s.value}
                state={s.value}
                value={data.totals[s.count]}
                total={data.totals.total}
                active={query.state === s.value && !query.team && !query.priority && !query.org}
                onClick={() => go({ type: query.type, state: s.value })}
              />
            ))}
      </div>

      {drilled ? (
        <Card className="mb-4">
          <CardHeader
            title={drillDownTitle(query, data)}
            subtitle={
              tickets.data
                ? `${tickets.data.total} open ticket${tickets.data.total === 1 ? '' : 's'}, most urgent first${
                    tickets.data.total > tickets.data.items.length ? ` (first ${tickets.data.items.length} shown)` : ''
                  }.`
                : undefined
            }
            action={
              <Button variant="ghost" size="sm" onClick={() => go({ type: query.type })}>
                <X className="size-4" aria-hidden />
                Clear
              </Button>
            }
          />
          <CardBody>
            {tickets.isError ? (
              <p role="alert" className="text-[13px] text-critical-ink">
                Couldn’t load the tickets. {tickets.error instanceof Error ? tickets.error.message : ''}
              </p>
            ) : (
              <DataTable
                data={tickets.data?.items ?? []}
                columns={cols}
                isLoading={tickets.isLoading}
                density="compact"
                emptyTitle="No open tickets here"
                emptyDescription="Nothing matches this breakdown right now."
              />
            )}
          </CardBody>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <SlaBreakdownCard
          title="By team"
          noun="Team"
          groups={data?.byTeam}
          isLoading={dashboard.isLoading}
          onPick={pick('team')}
          selected={selectedTeam}
        />
        <SlaBreakdownCard
          title="By priority"
          noun="Priority"
          groups={data?.byPriority}
          isLoading={dashboard.isLoading}
          onPick={pick('priority')}
          selected={query.priority}
        />
        <SlaBreakdownCard
          title="By customer"
          noun="Customer"
          groups={data?.byCustomer}
          isLoading={dashboard.isLoading}
          onPick={pick('org')}
          selected={query.org}
        />
      </div>
    </>
  );
}

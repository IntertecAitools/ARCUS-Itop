import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Ban, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Badge, Button, Card, CardBody, CardHeader, Select, Skeleton, Tabs } from '@/components/ui';
import { cn, dateTimeText } from '@/lib/utils';
import { useChangeCalendar } from '../api/useChanges';
import {
  changesOn,
  dayParam,
  parseDayParam,
  sameDay,
  shift,
  STATUS_LABEL,
  statusLook,
  TYPE_TONE,
  viewDays,
  viewTitle,
  viewWindow,
  windowsOn,
  type CalendarView,
} from '../lib/calendar';
import { CHANGE_TYPES, TYPE_LABEL } from '../lib/labels';
import type { Blackout, CalendarChange, ChangeType, NamedRef } from '../types';

const CLASS_OF: Record<ChangeType, string> = {
  routine: 'RoutineChange',
  normal: 'NormalChange',
  emergency: 'EmergencyChange',
};

/** Chip colours by type; literal class names so the design tokens survive the build. */
const CHIP: Record<ChangeType, string> = {
  routine: 'border-info/40 bg-info-soft text-info-ink',
  normal: 'border-brand/40 bg-brand-soft text-brand-ink',
  emergency: 'border-serious/40 bg-serious-soft text-serious-ink',
};

const VIEWS = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'day', label: 'Day' },
];

/** Chips a month cell shows before "+ n more". */
const MONTH_CELL_MAX = 3;

const FILTERS = [
  { key: 'teamId', label: 'All teams', option: 'teams' },
  { key: 'ciId', label: 'All CIs', option: 'cis' },
  { key: 'serviceId', label: 'All services', option: 'services' },
  { key: 'orgId', label: 'All organizations', option: 'organizations' },
] as const;

const timeText = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

const changePath = (c: CalendarChange) => `/records/${CLASS_OF[c.type]}/${c.id}`;

function chipTitle(c: CalendarChange): string {
  return [
    `${c.ref} ${c.title}`,
    `${TYPE_LABEL[c.type]} · ${STATUS_LABEL[c.status]}`,
    `${dateTimeText(c.start)}${c.end ? ` – ${dateTimeText(c.end)}` : ''}`,
    ...c.clashes.map((x) => `Clashes with ${x.ref} on ${x.on.map((o) => o.name).join(', ')}`),
    ...c.blackouts.map((b) => `In blackout window: ${b.name}`),
  ].join('\n');
}

/** A change on the calendar: coloured by type, faded once done, struck through when it will not happen. */
function ChangeChip({ change, showTime = true }: { change: CalendarChange; showTime?: boolean }) {
  const look = statusLook(change.status);
  return (
    <Link
      to={changePath(change)}
      title={chipTitle(change)}
      className={cn(
        'flex min-w-0 items-center gap-1 rounded-control border px-1.5 py-0.5 text-[11px] leading-4 hover:underline',
        CHIP[change.type],
        look === 'done' && 'opacity-60',
        look === 'cancelled' && 'line-through opacity-60',
      )}
    >
      {change.clashes.length ? <AlertTriangle className="size-3 shrink-0 text-critical" aria-label="Clash" /> : null}
      {change.blackouts.length ? <Ban className="size-3 shrink-0 text-warning-ink" aria-label="In a blackout window" /> : null}
      {showTime ? <span className="shrink-0 tabular-nums">{timeText(change.start)}</span> : null}
      <span className="truncate font-medium">{change.ref}</span>
    </Link>
  );
}

/**
 * Changes by planned start and end: a month, a week or a day at a time,
 * coloured by type and status, filtered by team, CI, service or organisation.
 * Two changes on the same CI or service at overlapping times are flagged as
 * a clash, and so is any change inside a blackout window an administrator
 * set. Each change opens on its record screen.
 */
export function ChangeCalendarPage() {
  const [params, setParams] = useSearchParams();
  const view = (['month', 'week', 'day'].includes(params.get('view') ?? '') ? params.get('view') : 'month') as CalendarView;
  const anchor = parseDayParam(params.get('date')) ?? new Date();
  const filters = Object.fromEntries(
    FILTERS.map((f) => [f.key, params.get(f.key) ?? undefined]).filter(([, v]) => v),
  ) as Partial<Record<(typeof FILTERS)[number]['key'], string>>;

  const window = viewWindow(view, anchor);
  const calendar = useChangeCalendar({ ...window, ...filters });
  const data = calendar.data;
  const days = viewDays(view, anchor);

  const set = (next: Record<string, string | undefined>) => {
    const p = new URLSearchParams(params);
    for (const [k, v] of Object.entries(next)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setParams(p, { replace: true });
  };

  const attention = useMemo(
    () => (data?.items ?? []).filter((c) => c.clashes.length > 0 || c.blackouts.length > 0),
    [data],
  );

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Change calendar' }]}
        title="Change calendar"
        description="Changes by planned dates. Clashes on the same CI or service, and changes inside blackout windows, are flagged."
      />

      <Card className="mb-4">
        <CardBody className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" aria-label="Previous" onClick={() => set({ date: dayParam(shift(view, anchor, -1)) })}>
              <ChevronLeft className="size-4 rtl:-scale-x-100" aria-hidden />
            </Button>
            <Button variant="secondary" size="sm" onClick={() => set({ date: undefined })}>
              Today
            </Button>
            <Button variant="secondary" size="sm" aria-label="Next" onClick={() => set({ date: dayParam(shift(view, anchor, 1)) })}>
              <ChevronRight className="size-4 rtl:-scale-x-100" aria-hidden />
            </Button>
          </div>
          <h2 className="min-w-0 flex-1 text-[15px] font-semibold text-ink" aria-live="polite">
            {viewTitle(view, anchor)}
          </h2>
          <Tabs items={VIEWS} value={view} onChange={(v) => set({ view: v === 'month' ? undefined : v })} className="border-b-0" />
        </CardBody>
        <CardBody className="flex flex-wrap items-center gap-2 border-t border-line">
          {FILTERS.map((f) => (
            <Select
              key={f.key}
              aria-label={f.label}
              className="w-48"
              value={filters[f.key] ?? ''}
              onChange={(e) => set({ [f.key]: e.target.value || undefined })}
              options={[
                { value: '', label: f.label },
                ...withSelected(data?.options[f.option] ?? [], filters[f.key]).map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
          ))}
          <div className="ms-auto flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
            {CHANGE_TYPES.map((t) => (
              <Badge key={t} size="sm" dot tone={TYPE_TONE[t]}>
                {TYPE_LABEL[t]}
              </Badge>
            ))}
            <span className="inline-flex items-center gap-1">
              <AlertTriangle className="size-3.5 text-critical" aria-hidden /> Clash
            </span>
            <span className="inline-flex items-center gap-1">
              <Ban className="size-3.5 text-warning-ink" aria-hidden /> Blackout
            </span>
          </div>
        </CardBody>
      </Card>

      {calendar.isError ? (
        <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load the calendar. {calendar.error instanceof Error ? calendar.error.message : ''}
        </div>
      ) : null}
      {data?.truncated ? (
        <div role="status" className="mb-4 rounded-card border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-ink">
          More changes are planned in this period than the calendar shows. Narrow it with a filter or a shorter view.
        </div>
      ) : null}

      {calendar.isLoading || !data ? (
        <Skeleton className="h-[480px] w-full" />
      ) : view === 'day' ? (
        <DayList day={days[0]!} items={data.items} blackouts={data.blackouts} />
      ) : (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-line bg-surface-sunken text-[11px] font-medium uppercase tracking-wide text-ink-muted">
            {days.slice(0, 7).map((d) => (
              <div key={d.toISOString()} className="px-2 py-1.5">
                {d.toLocaleDateString(undefined, { weekday: 'short' })}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => (
              <DayCell
                key={day.toISOString()}
                day={day}
                view={view}
                outside={view === 'month' && day.getMonth() !== anchor.getMonth()}
                items={changesOn(data.items, day)}
                blackouts={windowsOn(data.blackouts, day)}
                onOpenDay={() => set({ view: 'day', date: dayParam(day) })}
              />
            ))}
          </div>
        </Card>
      )}

      {data && view !== 'day' ? (
        <Card className="mt-4">
          <CardHeader
            title="Needs attention"
            subtitle={
              attention.length
                ? `${attention.length} change${attention.length === 1 ? '' : 's'} with a clash or in a blackout window`
                : 'No clashes and nothing in a blackout window in this period'
            }
          />
          {attention.length ? (
            <CardBody>
              <AttentionList items={attention} />
            </CardBody>
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

/** A filter's chosen value stays in its list even when the window has no change for it. */
function withSelected(options: NamedRef[], selected: string | undefined): NamedRef[] {
  if (!selected || options.some((o) => o.id === selected)) return options;
  return [...options, { id: selected, name: `#${selected}` }];
}

function DayCell({
  day,
  view,
  outside,
  items,
  blackouts,
  onOpenDay,
}: {
  day: Date;
  view: CalendarView;
  outside: boolean;
  items: CalendarChange[];
  blackouts: Blackout[];
  onOpenDay: () => void;
}) {
  const max = view === 'month' ? MONTH_CELL_MAX : Infinity;
  const today = sameDay(day, new Date());
  return (
    <div
      className={cn(
        'min-h-28 border-b border-e border-line p-1.5 [&:nth-child(7n)]:border-e-0',
        view === 'week' && 'min-h-72',
        outside && 'bg-surface-sunken',
        blackouts.length > 0 && 'bg-warning-soft/60',
      )}
    >
      <div className="mb-1 flex items-center justify-between gap-1">
        <button
          type="button"
          onClick={onOpenDay}
          className={cn(
            'rounded-pill px-1.5 text-[12px] tabular-nums hover:bg-neutral-soft',
            today ? 'bg-brand font-semibold text-on-brand hover:bg-brand' : outside ? 'text-ink-muted' : 'text-ink',
          )}
          aria-label={`Open ${day.toLocaleDateString()}`}
        >
          {day.getDate()}
        </button>
        {blackouts.length ? (
          <span className="truncate text-[10px] font-medium text-warning-ink" title={blackouts.map((b) => b.name).join(', ')}>
            {blackouts[0]!.name}
          </span>
        ) : null}
      </div>
      <ul className="space-y-0.5">
        {items.slice(0, max).map((c) => (
          <li key={c.id}>
            <ChangeChip change={c} />
          </li>
        ))}
      </ul>
      {items.length > max ? (
        <button type="button" onClick={onOpenDay} className="mt-0.5 text-[11px] text-brand-ink hover:underline">
          + {items.length - max} more
        </button>
      ) : null}
    </div>
  );
}

function DayList({ day, items, blackouts }: { day: Date; items: CalendarChange[]; blackouts: Blackout[] }) {
  const onDay = changesOn(items, day);
  const windows = windowsOn(blackouts, day);
  return (
    <Card>
      <CardHeader title={`${onDay.length} change${onDay.length === 1 ? '' : 's'}`} />
      <CardBody className="space-y-3">
        {windows.map((b) => (
          <div key={b.id} role="status" className="flex items-start gap-2 rounded-card border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] text-ink">
            <Ban className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden />
            <span>
              <span className="font-medium">Blackout: {b.name}</span> {dateTimeText(b.start)} – {dateTimeText(b.end)}
              {b.reason ? <span className="text-ink-secondary">. {b.reason}</span> : null}
            </span>
          </div>
        ))}
        {onDay.length === 0 ? <p className="text-[13px] text-ink-muted">No change is planned on this day.</p> : <AttentionList items={onDay} />}
      </CardBody>
    </Card>
  );
}

/** Changes in full: when, what they touch, and what is wrong with them. */
function AttentionList({ items }: { items: CalendarChange[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((c) => (
        <li key={c.id} className="flex flex-wrap items-start gap-x-4 gap-y-1 py-2.5 text-[13px]">
          <div className="w-44 shrink-0 tabular-nums text-ink-secondary">
            {dateTimeText(c.start)}
            {c.end ? <div className="text-ink-muted">to {dateTimeText(c.end)}</div> : null}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link to={changePath(c)} className="font-medium text-brand-ink hover:underline">
                {c.ref}
              </Link>
              <span className="text-ink">{c.title}</span>
              <Badge size="sm" tone={TYPE_TONE[c.type]}>
                {TYPE_LABEL[c.type]}
              </Badge>
              <Badge size="sm" tone="neutral">
                {STATUS_LABEL[c.status]}
              </Badge>
              {c.risk ? (
                <Badge size="sm" tone={c.risk === 'high' ? 'critical' : c.risk === 'medium' ? 'warning' : 'good'}>
                  {c.risk} risk
                </Badge>
              ) : null}
            </div>
            <p className="mt-0.5 text-ink-muted">
              {[c.organization.name, c.team?.name, c.cis.map((x) => x.name).join(', '), c.services.map((x) => x.name).join(', ')]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {c.clashes.map((x) => (
              <p key={x.changeId} className="mt-0.5 flex items-center gap-1 text-critical-ink">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                Clashes with {x.ref} on {x.on.map((o) => `${o.kind === 'ci' ? 'CI' : 'service'} ${o.name}`).join(', ')}
              </p>
            ))}
            {c.blackouts.map((b) => (
              <p key={b.id} className="mt-0.5 flex items-center gap-1 text-warning-ink">
                <Ban className="size-3.5 shrink-0" aria-hidden />
                Inside the blackout window {b.name}
              </p>
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

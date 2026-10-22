import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  AppWindow,
  ArrowRight,
  Box,
  Cloud,
  Cpu,
  Database,
  FileText,
  HardDrive,
  Layers,
  MapPin,
  Monitor,
  Network,
  Package,
  Phone,
  Printer,
  Server,
  Smartphone,
  Tablet,
  Ticket,
  Users,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardBody, Skeleton } from '@/components/ui';
import { DonutChart, ChartTooltip } from '@/components/data-display';
import { seriesPalette } from '@/theme/charts';
import { cn } from '@/lib/utils';
import { useDashletData, type DashletData, type PublicDashlet } from '../api/useDashboard';
import { formatGroupKey, pluralLabel, splitClassName } from '../lib/labels';

/**
 * One dashboard panel, rendered by kind from the data the BFF computes.
 *
 * The BFF runs the dashlet's OQL and returns a count, grouped counts, or a
 * row list; this only draws it. iTop's labels come through on the data, so a
 * "by status" chart reads "New / Assigned / Resolved", not raw codes, and a
 * count reads "Business processes", not "BusinessProcess".
 *
 * Counts render as compact KPI tiles; everything else as a chart panel. The
 * page (DashboardViewPage) lays tiles out in a grid and panels two-up.
 */

/** Icons by class; anything else gets a plain box. */
const CLASS_ICONS: Record<string, LucideIcon> = {
  Contact: Users,
  Person: Users,
  Team: Users,
  Location: MapPin,
  Contract: FileText,
  CustomerContract: FileText,
  ProviderContract: FileText,
  BusinessProcess: Workflow,
  ApplicationSolution: AppWindow,
  WebApplication: AppWindow,
  Server: Server,
  Hypervisor: Server,
  NetworkDevice: Network,
  NetworkInterface: Network,
  Subnet: Network,
  VLAN: Network,
  StorageSystem: HardDrive,
  NAS: HardDrive,
  NASFileSystem: HardDrive,
  LogicalVolume: HardDrive,
  TapeLibrary: HardDrive,
  Tape: HardDrive,
  DBServer: Database,
  DatabaseSchema: Database,
  Software: Package,
  PCSoftware: Package,
  OtherSoftware: Package,
  Middleware: Layers,
  MiddlewareInstance: Layers,
  PC: Monitor,
  Phone: Phone,
  IPPhone: Phone,
  MobilePhone: Smartphone,
  Tablet: Tablet,
  Printer: Printer,
  Peripheral: Cpu,
  VirtualMachine: Cloud,
  Cloud: Cloud,
  Farm: Cloud,
  UserRequest: Ticket,
  Incident: Ticket,
};

const classIcon = (className: string) => CLASS_ICONS[className] ?? Box;

/** The plural a tile or link reads: the class's iTop label, else its spaced name. */
const pluralOf = (data: { class: string; label?: string }) =>
  pluralLabel(data.label && data.label !== data.class ? data.label : splitClassName(data.class));

/** Mid-sentence: "Business processes" → "business processes", but "IP phones" stays. */
const inSentence = (text: string) => (/^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text);

/** A panel: a card with a title, used for every chart, table and list. */
function Panel({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <Card className="flex h-full flex-col">
      <CardBody className="flex flex-1 flex-col pt-5">
        {title ? <h2 className="mb-4 text-[15px] leading-6 font-medium text-ink">{title}</h2> : null}
        <div className="flex-1">{children}</div>
        {footer ? <div className="mt-4 border-t border-line pt-3">{footer}</div> : null}
      </CardBody>
    </Card>
  );
}

function NothingYet({ children = 'Nothing to show yet.' }: { children?: ReactNode }) {
  return (
    <div className="flex h-full min-h-32 items-center justify-center border border-dashed border-line px-4 py-8 text-center text-[13px] text-ink-muted">
      {children}
    </div>
  );
}

function ViewAll({ className, label }: { className: string; label: string }) {
  return (
    <Link
      to={`/records/${className}`}
      className="inline-flex items-center gap-1.5 text-[12px] font-semibold tracking-[0.12em] text-ink uppercase underline-offset-4 hover:underline"
    >
      View all {label}
      <ArrowRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
    </Link>
  );
}

/** A compact count tile: icon, number, plural label; links to the list. */
export function KpiTile({
  to,
  icon: Icon,
  count,
  label,
}: {
  to: string;
  icon: LucideIcon;
  count: number | null;
  label: string;
}) {
  const zero = count === 0;
  return (
    <Link
      to={to}
      className={cn(
        // Phones: icon above the number, two tiles a row; wider: icon beside it.
        'group flex h-full flex-col items-start gap-3 border border-line bg-surface p-3.5 transition-colors hover:border-line-strong hover:bg-surface-hover sm:flex-row sm:items-center sm:gap-4 sm:p-4',
        zero && 'bg-transparent',
      )}
    >
      <span
        className={cn(
          'flex size-8 shrink-0 items-center justify-center border border-line sm:size-10',
          zero ? 'text-ink-muted' : 'text-ink',
        )}
        aria-hidden
      >
        <Icon className="size-5 stroke-[1.5]" />
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            'display block text-[28px] leading-none tabular-nums',
            zero ? 'text-ink-muted' : 'text-ink',
          )}
        >
          {count === null ? '…' : count.toLocaleString()}
        </span>
        <span className={cn('mt-1.5 line-clamp-2 block text-[13px] leading-5', zero ? 'text-ink-muted' : 'text-ink-secondary')}>
          {label}
        </span>
      </span>
    </Link>
  );
}

/** One count dashlet as a tile. */
function BadgeTile({ dashboardId, dashlet }: { dashboardId: string; dashlet: PublicDashlet }) {
  const { data, isLoading, isError } = useDashletData(dashboardId, dashlet.id);
  const className = dashlet.class ?? (data && 'class' in data ? data.class : '') ?? '';
  if (isLoading) return <Skeleton className="h-[74px]" />;
  const badge = data?.kind === 'badge' ? data : null;
  const label = dashlet.title || pluralOf({ class: className, label: badge?.label });
  return (
    <KpiTile
      to={`/records/${className}`}
      icon={classIcon(className)}
      count={isError || !badge ? null : badge.count}
      label={label}
    />
  );
}

/**
 * The page asks for these by kind: counts are tiles in a grid, a
 * header-dynamic is a titled row of tiles, the rest are panels.
 */
export function Dashlet({ dashboardId, dashlet }: { dashboardId: string; dashlet: PublicDashlet }) {
  if (dashlet.kind === 'badge') return <BadgeTile dashboardId={dashboardId} dashlet={dashlet} />;
  if (dashlet.kind === 'header' || dashlet.kind === 'text') return <TextDashlet dashlet={dashlet} />;
  return <DataPanel dashboardId={dashboardId} dashlet={dashlet} />;
}

function TextDashlet({ dashlet }: { dashlet: PublicDashlet }) {
  return (
    <Panel title={dashlet.title}>
      {dashlet.text ? <p className="text-[14px] leading-6 text-ink-secondary">{dashlet.text}</p> : null}
    </Panel>
  );
}

function DataPanel({ dashboardId, dashlet }: { dashboardId: string; dashlet: PublicDashlet }) {
  const { data, isLoading, isError, error } = useDashletData(dashboardId, dashlet.id);

  if (isLoading) {
    return (
      <Panel title={dashlet.title}>
        <Skeleton className="h-48" />
      </Panel>
    );
  }

  if (isError || !data) {
    return (
      <Panel title={dashlet.title}>
        <p role="alert" className="text-[13px] text-critical-ink">
          Couldn’t load this panel. {error instanceof Error ? error.message : ''}
        </p>
      </Panel>
    );
  }

  return <DataBody dashlet={dashlet} data={data} />;
}

function DataBody({ dashlet, data }: { dashlet: PublicDashlet; data: DashletData }) {
  if (data.kind === 'badge' || data.kind === 'text' || data.kind === 'header') return null;

  if (data.kind === 'list') {
    return (
      <Panel
        title={dashlet.title}
        footer={
          data.total > data.items.length ? (
            <ViewAll className={data.class} label={`${data.total.toLocaleString()} ${inSentence(pluralOf(data))}`} />
          ) : null
        }
      >
        {data.items.length === 0 ? (
          <NothingYet />
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((row) => (
              <li key={row.id}>
                <Link
                  to={`/records/${data.class}/${row.id}`}
                  className="block truncate py-2.5 text-[14px] text-ink hover:underline"
                >
                  {row.label || `#${row.id}`}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    );
  }

  // The narrow tells TypeScript the text/header variants are handled above.
  if (
    data.kind !== 'pie' &&
    data.kind !== 'bars' &&
    data.kind !== 'table' &&
    data.kind !== 'header-dynamic'
  ) {
    return null;
  }
  const keyType = data.keyType ?? 'value';
  const groups = data.groups.map((g) => ({ ...g, label: formatGroupKey(g.key, g.label, keyType) }));
  // Past the BFF's scan limit the groups cover part of the matches: say so
  // rather than show a total the slices do not add up to.
  const counted = groups.reduce((sum, g) => sum + g.count, 0);
  const partial = data.truncated ? (
    <p className="mt-3 text-[12px] text-ink-muted">
      Grouped from the first {counted.toLocaleString()} of {data.total.toLocaleString()} records.
    </p>
  ) : null;
  const empty = groups.length === 0 || counted === 0;

  if (data.kind === 'header-dynamic') {
    // A titled row of counts (e.g. requests by status), each a tile.
    return (
      <section aria-label={dashlet.title}>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {groups.map((g) => (
            <KpiTile
              key={g.key}
              to={`/records/${data.class}`}
              icon={classIcon(data.class)}
              count={g.count}
              label={g.label}
            />
          ))}
        </div>
        {partial}
      </section>
    );
  }

  if (data.kind === 'pie') {
    return (
      <Panel title={dashlet.title} footer={<ViewAll className={data.class} label={inSentence(pluralOf(data))} />}>
        {empty ? (
          <NothingYet>Nothing matches yet.</NothingYet>
        ) : (
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
            <DonutChart
              data={groups.slice(0, 8).map((g) => ({ key: g.key, label: g.label, value: g.count }))}
              centerValue={String(data.total)}
              centerLabel="total"
            />
            {/* The legend: same slot order as the slices, so colour + label + count agree. */}
            <ul className="w-full min-w-0 space-y-2 sm:w-auto sm:min-w-40">
              {groups.slice(0, 8).map((g, i) => (
                <li key={g.key} className="flex items-center gap-2.5 text-[13px]">
                  <span
                    className="size-2.5 shrink-0"
                    style={{ backgroundColor: seriesPalette[i % seriesPalette.length] }}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1 truncate text-ink-secondary">{g.label}</span>
                  <span className="font-medium text-ink tabular-nums">{g.count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {partial}
      </Panel>
    );
  }

  if (data.kind === 'bars') {
    return (
      <Panel title={dashlet.title} footer={<ViewAll className={data.class} label={inSentence(pluralOf(data))} />}>
        {empty ? (
          <NothingYet>Nothing in this period.</NothingYet>
        ) : (
          // Charts read left to right whatever the page direction.
          <div dir="ltr" style={{ width: '100%', height: 240 }}>
            <ResponsiveContainer>
              <BarChart data={groups} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--arcus-grid)" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--arcus-ink-muted)' }}
                  stroke="var(--arcus-line-strong)"
                  interval="preserveStartEnd"
                  minTickGap={8}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--arcus-ink-muted)' }}
                  stroke="var(--arcus-line-strong)"
                />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--arcus-surface-hover)' }} />
                <Bar dataKey="count" name={pluralOf(data)} fill={seriesPalette[0]} maxBarSize={36} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        {partial}
      </Panel>
    );
  }

  // table: a labelled count list, each row with a bar for its share.
  const max = Math.max(1, ...groups.map((g) => g.count));
  return (
    <Panel title={dashlet.title} footer={<ViewAll className={data.class} label={inSentence(pluralOf(data))} />}>
      {empty ? (
        <NothingYet>Nothing matches yet.</NothingYet>
      ) : (
        <ul className="space-y-3">
          {groups.map((g) => (
            <li key={g.key}>
              <div className="flex items-baseline justify-between gap-4 text-[14px]">
                <span className="min-w-0 truncate text-ink-secondary">{g.label}</span>
                <span className="font-medium text-ink tabular-nums">{g.count.toLocaleString()}</span>
              </div>
              <div className="mt-1.5 h-1 bg-surface-sunken" aria-hidden>
                <div className="h-full bg-ink/70" style={{ width: `${(g.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {partial}
    </Panel>
  );
}

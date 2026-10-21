import { Link } from 'react-router-dom';
import { BarChart3, LayoutDashboard } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Card, CardBody, Skeleton } from '@/components/ui';
import { DonutChart, ChartTooltip } from '@/components/data-display';
import { seriesPalette } from '@/theme/charts';
import { useDashletData, type PublicDashlet } from '../api/useDashboard';

/**
 * One dashboard panel, rendered by kind from the data the BFF computes.
 *
 * The BFF runs the dashlet's OQL and returns a count, grouped counts, or a
 * row list; this only draws it. iTop's labels come through on the data, so a
 * "by status" chart reads "New / Assigned / Resolved", not raw codes.
 */

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="h-full">
      <CardBody>
        {title ? (
          <p className="mb-3 text-[13px] font-semibold text-ink">{title}</p>
        ) : null}
        {children}
      </CardBody>
    </Card>
  );
}

export function Dashlet({ dashboardId, dashlet }: { dashboardId: string; dashlet: PublicDashlet }) {
  // Static dashlets need no data call.
  const needsData = !['text', 'header'].includes(dashlet.kind);
  const { data, isLoading, isError, error } = useDashletData(dashboardId, dashlet.id, needsData);

  // Header / plain text: no query, just the configured text.
  if (dashlet.kind === 'header' || dashlet.kind === 'text') {
    return (
      <Card className="h-full">
        <CardBody>
          <p className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <LayoutDashboard className="size-4 text-ink-muted" aria-hidden />
            {dashlet.title}
          </p>
          {dashlet.text ? (
            <p className="mt-1 text-[12.5px] text-ink-secondary">{dashlet.text}</p>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <Panel title={dashlet.title}>
        <Skeleton className="h-40" />
      </Panel>
    );
  }

  if (isError || !data) {
    return (
      <Panel title={dashlet.title}>
        <p role="alert" className="text-[12.5px] text-critical-ink">
          Couldn’t load this panel. {error instanceof Error ? error.message : ''}
        </p>
      </Panel>
    );
  }

  // A single big number, with a link to the full list.
  if (data.kind === 'badge') {
    return (
      <Card className="h-full">
        <CardBody>
          <Link to={`/records/${data.class}`} className="block">
            <p className="text-[32px] leading-none font-semibold text-ink tabular-nums">
              {data.count}
            </p>
            <p className="mt-1 text-[12.5px] text-ink-secondary">{dashlet.title || data.class}</p>
          </Link>
        </CardBody>
      </Card>
    );
  }

  if (data.kind === 'list') {
    return (
      <Panel title={dashlet.title}>
        {data.items.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">Nothing to show.</p>
        ) : (
          <ul className="divide-y divide-line">
            {data.items.map((row) => (
              <li key={row.id} className="py-1.5 text-[13px]">
                <Link
                  to={`/records/${data.class}/${row.id}`}
                  className="text-brand-ink hover:underline"
                >
                  {row.label || `#${row.id}`}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {data.total > data.items.length ? (
          <Link
            to={`/records/${data.class}`}
            className="mt-2 inline-block text-[12px] text-brand-ink hover:underline"
          >
            View all {data.total} →
          </Link>
        ) : null}
      </Panel>
    );
  }

  // Grouped data: pie, bars, table, or a header-style count row. The narrow
  // tells TypeScript the text/header variants are already handled above.
  if (
    data.kind !== 'pie' &&
    data.kind !== 'bars' &&
    data.kind !== 'table' &&
    data.kind !== 'header-dynamic'
  ) {
    return null;
  }
  const groups = data.groups;

  if (data.kind === 'pie') {
    return (
      <Panel title={dashlet.title}>
        {groups.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">No data.</p>
        ) : (
          <div className="flex items-center justify-center">
            <DonutChart
              data={groups.slice(0, 8).map((g) => ({ key: g.key, label: g.label, value: g.count }))}
              centerValue={String(data.total)}
              centerLabel="total"
            />
          </div>
        )}
      </Panel>
    );
  }

  if (data.kind === 'bars') {
    return (
      <Panel title={dashlet.title}>
        {groups.length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">No data.</p>
        ) : (
          <div style={{ width: '100%', height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={groups} margin={{ top: 8, right: 8, bottom: 4, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--arcus-grid)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--arcus-ink-muted)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--arcus-ink-muted)" />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                  {groups.map((g, i) => (
                    <Cell key={g.key} fill={seriesPalette[i % seriesPalette.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Panel>
    );
  }

  // table and header-dynamic: a compact labelled count list.
  return (
    <Panel title={dashlet.title}>
      {groups.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted">No data.</p>
      ) : (
        <table className="w-full text-[13px]">
          <tbody>
            {groups.map((g) => (
              <tr key={g.key} className="border-b border-line last:border-0">
                <td className="py-1.5 text-ink-secondary">{g.label}</td>
                <td className="py-1.5 text-end font-medium text-ink tabular-nums">{g.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {'class' in data && data.class ? (
        <Link
          to={`/records/${data.class}`}
          className="mt-2 inline-flex items-center gap-1 text-[12px] text-brand-ink hover:underline"
        >
          <BarChart3 className="size-3" /> View {data.class}
        </Link>
      ) : null}
    </Panel>
  );
}

import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { Pagination, usePagedRows } from '@/components/data-display';
import { useWorklogReport } from '../api/useTicketHandling';
import { formatMinutes, ticketPath, todayInput } from '../lib/format';

const daysBefore = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - n);
  return todayInput(d);
};

interface ReportRow {
  key: string;
  label: ReactNode;
  entries: number;
  minutes: number;
}

/** One of the report's breakdowns: a paged table, flush with its card. */
function ReportCard({ title, noun, rows, resetKey }: { title: string; noun: string; rows: ReportRow[]; resetKey: string }) {
  const { pageRows, pagination } = usePagedRows(rows, { resetKey });
  return (
    <Card className="overflow-hidden">
      <CardHeader title={title} />
      {rows.length === 0 ? (
        <CardBody>
          <p className="text-[13px] text-ink-muted">No time logged in this period.</p>
        </CardBody>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="ui-table">
              <thead>
                <tr>
                  <th className="ps-5">{noun}</th>
                  <th className="text-end">Entries</th>
                  <th className="pe-5 text-end">Time</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.key}>
                    <td className="ps-5 text-ink">{row.label}</td>
                    <td className="text-end text-ink-secondary">{row.entries}</td>
                    <td className="pe-5 text-end font-medium text-ink">{formatMinutes(row.minutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination {...pagination} />
        </>
      )}
    </Card>
  );
}

/** Time logged on incidents and requests in a period: per agent and per ticket. */
export function TimeReportPage() {
  const [to, setTo] = useState(todayInput());
  const [from, setFrom] = useState(daysBefore(todayInput(), 29));
  const { data, isLoading, error } = useWorklogReport({ from, to });
  const period = `${from}|${to}`;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Time logged' }]}
        title="Time logged"
        description="What agents logged against incidents and requests, for the tickets you can see."
      />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <label className="text-[12.5px] text-ink-secondary">
          From
          <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="mt-1" />
        </label>
        <label className="text-[12.5px] text-ink-secondary">
          To
          <Input type="date" value={to} min={from} max={todayInput()} onChange={(e) => setTo(e.target.value)} className="mt-1" />
        </label>
        {data ? (
          <p className="pb-2 text-[13px] text-ink">
            <span className="font-semibold">{formatMinutes(data.totalMinutes)}</span> in total
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="mb-4 text-[13px] text-critical-ink">
          {error instanceof Error ? error.message : 'Could not load the report.'}
        </p>
      ) : null}
      {isLoading ? (
        <Skeleton className="h-40" />
      ) : data ? (
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <ReportCard
            title="Per agent"
            noun="Agent"
            resetKey={period}
            rows={data.byAgent.map((a) => ({ key: String(a.userId), label: a.name, entries: a.entries, minutes: a.minutes }))}
          />
          <ReportCard
            title="Per ticket"
            noun="Ticket"
            resetKey={period}
            rows={data.byTicket.map((t) => ({
              key: `${t.class}-${t.ticketId}`,
              label: (
                <Link to={ticketPath(t.class, t.ticketId)} className="text-brand-ink hover:underline">
                  {t.ticketRef}
                </Link>
              ),
              entries: t.entries,
              minutes: t.minutes,
            }))}
          />
        </div>
      ) : null}
    </>
  );
}

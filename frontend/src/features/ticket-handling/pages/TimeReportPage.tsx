import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout';
import { Card, CardBody, CardHeader, Input, Skeleton } from '@/components/ui';
import { useWorklogReport } from '../api/useTicketHandling';
import { formatMinutes, ticketPath, todayInput } from '../lib/format';

const daysBefore = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00`);
  d.setDate(d.getDate() - n);
  return todayInput(d);
};

/** Time logged on incidents and requests in a period: per agent and per ticket. */
export function TimeReportPage() {
  const [to, setTo] = useState(todayInput());
  const [from, setFrom] = useState(daysBefore(todayInput(), 29));
  const { data, isLoading, error } = useWorklogReport({ from, to });

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
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader title="Per agent" />
            <CardBody>
              {data.byAgent.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No time logged in this period.</p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-start text-[12px] text-ink-muted">
                      <th className="py-1 text-start font-medium">Agent</th>
                      <th className="py-1 text-end font-medium">Entries</th>
                      <th className="py-1 text-end font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.byAgent.map((a) => (
                      <tr key={a.userId}>
                        <td className="py-1.5 text-ink">{a.name}</td>
                        <td className="py-1.5 text-end text-ink-secondary">{a.entries}</td>
                        <td className="py-1.5 text-end font-medium text-ink">{formatMinutes(a.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Per ticket" />
            <CardBody>
              {data.byTicket.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No time logged in this period.</p>
              ) : (
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-[12px] text-ink-muted">
                      <th className="py-1 text-start font-medium">Ticket</th>
                      <th className="py-1 text-end font-medium">Entries</th>
                      <th className="py-1 text-end font-medium">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {data.byTicket.map((t) => (
                      <tr key={`${t.class}-${t.ticketId}`}>
                        <td className="py-1.5">
                          <Link to={ticketPath(t.class, t.ticketId)} className="text-brand-ink hover:underline">
                            {t.ticketRef}
                          </Link>
                        </td>
                        <td className="py-1.5 text-end text-ink-secondary">{t.entries}</td>
                        <td className="py-1.5 text-end font-medium text-ink">{formatMinutes(t.minutes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}
    </>
  );
}

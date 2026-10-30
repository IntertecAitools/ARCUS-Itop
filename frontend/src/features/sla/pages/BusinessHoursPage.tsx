import { useState } from 'react';
import { CalendarOff, Clock, Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Badge, Button, Card, CardBody, CardHeader, Input, Select, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { longDate } from '@/lib/utils';
import {
  useAssignWindow,
  useBusinessHours,
  useCreateCalendar,
  useCreateHoliday,
  useDeleteCalendar,
  useDeleteHoliday,
  useDeleteWindow,
  useSaveWindow,
} from '../api/useBusinessHours';
import { CoverageWindowEditor } from '../components/CoverageWindowEditor';
import { summarise } from '../lib/business-hours';
import type { BusinessHours, CoverageWindow } from '../business-hours.types';

const message = (error: unknown) => (error instanceof Error ? error.message : undefined);

function Problem({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="mt-3 rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
      {message(error) ?? 'That did not work.'}
    </div>
  ) : null;
}

/* ------------------------------------------------------------------------- *
 * Coverage windows
 * ------------------------------------------------------------------------- */

function CoverageWindowsCard({ data }: { data: BusinessHours }) {
  const save = useSaveWindow();
  const remove = useDeleteWindow();
  /** "new", a window id, or null when nothing is being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const current = data.coverageWindows.find((w) => w.id === editing);

  const confirmDelete = (w: CoverageWindow) => {
    const note = w.usedBy
      ? ` ${w.usedBy} contract service${w.usedBy === 1 ? '' : 's'} will go back to counting around the clock.`
      : '';
    if (window.confirm(`Delete the coverage window “${w.name}”?${note}`)) remove.mutate(w.id);
  };

  return (
    <Card className="mb-4">
      <CardHeader
        title="Coverage windows"
        subtitle="The open hours TTO and TTR count in. A ticket counts in the window of its customer contract’s service; without one it counts around the clock."
        action={
          editing === null ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              New window
            </Button>
          ) : undefined
        }
      />
      <CardBody>
        {editing !== null ? (
          <div className="mb-4 rounded-card border border-line p-4">
            <CoverageWindowEditor
              key={editing}
              window={current}
              saving={save.isPending}
              error={message(save.error)}
              onCancel={() => {
                save.reset();
                setEditing(null);
              }}
              onSave={(input) =>
                save.mutate(
                  { id: current?.id, input },
                  {
                    onSuccess: () => setEditing(null),
                  },
                )
              }
            />
          </div>
        ) : null}

        {data.coverageWindows.length === 0 && editing === null ? (
          <EmptyState
            icon={<Clock className="size-5" />}
            title="No coverage windows yet"
            description="Every ticket’s TTO and TTR count around the clock until a window is set on a contract’s service."
          />
        ) : (
          <ul className="divide-y divide-line" aria-label="Coverage windows">
            {data.coverageWindows.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{w.name}</p>
                  <p className="text-[13px] text-ink-secondary">{summarise(w.intervals)}</p>
                  {w.description ? <p className="text-[12px] text-ink-muted">{w.description}</p> : null}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={w.usedBy ? 'info' : 'neutral'} size="sm">
                    {w.usedBy ? `${w.usedBy} contract service${w.usedBy === 1 ? '' : 's'}` : 'Not used'}
                  </Badge>
                  <Button variant="ghost" size="sm" aria-label={`Edit ${w.name}`} onClick={() => setEditing(w.id)}>
                    <Pencil className="size-4" aria-hidden />
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Delete ${w.name}`} onClick={() => confirmDelete(w)}>
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Problem error={remove.error} />
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------------- *
 * Holidays
 * ------------------------------------------------------------------------- */

function HolidaysCard({ data }: { data: BusinessHours }) {
  const createHoliday = useCreateHoliday();
  const deleteHoliday = useDeleteHoliday();
  const createCalendar = useCreateCalendar();
  const deleteCalendar = useDeleteCalendar();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [calendarId, setCalendarId] = useState('');
  const [calendarName, setCalendarName] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = data.holidays.filter((h) => h.date >= today);
  const past = data.holidays.length - upcoming.length;

  return (
    <Card className="mb-4">
      <CardHeader
        title="Holidays"
        subtitle="No hour of a holiday counts towards TTO or TTR, for every coverage window. Calendars only group them."
      />
      <CardBody>
        <form
          aria-label="New holiday"
          className="mb-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            createHoliday.mutate(
              { name: name.trim(), date, calendarId },
              {
                onSuccess: () => {
                  setName('');
                  setDate('');
                },
              },
            );
          }}
        >
          <label className="text-[13px] text-ink-secondary">
            Holiday
            <Input className="mt-1 w-56" value={name} onChange={(e) => setName(e.target.value)} required maxLength={255} />
          </label>
          <label className="text-[13px] text-ink-secondary">
            Date
            <Input type="date" className="mt-1 w-44" value={date} onChange={(e) => setDate(e.target.value)} required />
          </label>
          <label className="text-[13px] text-ink-secondary">
            Calendar
            <Select
              className="mt-1 w-48"
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              options={[{ value: '', label: 'None' }, ...data.calendars.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </label>
          <Button type="submit" size="sm" disabled={!name.trim() || !date} loading={createHoliday.isPending}>
            Add holiday
          </Button>
        </form>
        <Problem error={createHoliday.error ?? deleteHoliday.error} />

        {upcoming.length === 0 ? (
          <EmptyState
            icon={<CalendarOff className="size-5" />}
            title="No upcoming holidays"
            description="Add public holidays and closures so they don’t count against SLAs."
          />
        ) : (
          <table className="w-full text-[13px]" aria-label="Holidays">
            <thead>
              <tr className="text-start text-[12px] text-ink-muted">
                <th className="pb-2 font-medium">Date</th>
                <th className="pb-2 font-medium">Holiday</th>
                <th className="pb-2 font-medium">Calendar</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {upcoming.map((h) => (
                <tr key={h.id} className="border-t border-line">
                  <td className="py-1.5 tabular-nums">{longDate(`${h.date}T12:00:00`)}</td>
                  <td className="py-1.5 text-ink">{h.name}</td>
                  <td className="py-1.5 text-ink-secondary">{h.calendarName || '–'}</td>
                  <td className="py-1.5 text-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${h.name} (${h.date})`}
                      onClick={() => deleteHoliday.mutate(h.id)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {past ? <p className="mt-2 text-[12px] text-ink-muted">{past} past holiday{past === 1 ? '' : 's'} not shown.</p> : null}

        <div className="mt-6 border-t border-line pt-4">
          <h3 className="mb-2 text-[13px] font-medium text-ink">Calendars</h3>
          <div className="mb-3 flex flex-wrap gap-2">
            {data.calendars.length === 0 ? <span className="text-[13px] text-ink-muted">None yet.</span> : null}
            {data.calendars.map((c) => (
              <span key={c.id} className="flex items-center gap-1 rounded-control border border-line px-2 py-1 text-[13px]">
                {c.name}
                <span className="text-ink-muted">({c.holidayCount})</span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Delete calendar ${c.name}`}
                  onClick={() => {
                    const note = c.holidayCount ? ` Its ${c.holidayCount} holiday${c.holidayCount === 1 ? ' goes' : 's go'} with it.` : '';
                    if (window.confirm(`Delete the calendar “${c.name}”?${note}`)) deleteCalendar.mutate(c.id);
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              </span>
            ))}
          </div>
          <form
            aria-label="New calendar"
            className="flex items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              createCalendar.mutate({ name: calendarName.trim() }, { onSuccess: () => setCalendarName('') });
            }}
          >
            <label className="text-[13px] text-ink-secondary">
              New calendar
              <Input className="mt-1 w-56" value={calendarName} onChange={(e) => setCalendarName(e.target.value)} maxLength={255} />
            </label>
            <Button type="submit" variant="secondary" size="sm" disabled={!calendarName.trim()} loading={createCalendar.isPending}>
              Add calendar
            </Button>
          </form>
          <Problem error={createCalendar.error ?? deleteCalendar.error} />
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------------- *
 * Contract services
 * ------------------------------------------------------------------------- */

function AssignmentsCard({ data }: { data: BusinessHours }) {
  const assign = useAssignWindow();
  const options = [
    { value: '', label: 'Around the clock (24x7)' },
    ...data.coverageWindows.map((w) => ({ value: w.id, label: w.name })),
  ];

  return (
    <Card>
      <CardHeader
        title="Customer contracts"
        subtitle="The coverage window each service of a customer contract runs in. A change applies to tickets opened from then on; iTop keeps the deadlines it has already set."
      />
      <CardBody>
        {data.assignments.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-ink-muted">
            No services on customer contracts yet. Add them on a customer contract’s record.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]" aria-label="Contract services">
              <thead>
                <tr className="text-start text-[12px] text-ink-muted">
                  <th className="pb-2 font-medium">Customer</th>
                  <th className="pb-2 font-medium">Contract</th>
                  <th className="pb-2 font-medium">Service</th>
                  <th className="pb-2 font-medium">SLA</th>
                  <th className="pb-2 font-medium">Coverage window</th>
                </tr>
              </thead>
              <tbody>
                {data.assignments.map((a) => (
                  <tr key={a.id} className="border-t border-line">
                    <td className="py-1.5 text-ink">{a.customerName || '–'}</td>
                    <td className="py-1.5">{a.contractName}</td>
                    <td className="py-1.5">{a.serviceName}</td>
                    <td className="py-1.5 text-ink-secondary">{a.slaName || 'None'}</td>
                    <td className="py-1.5">
                      <Select
                        aria-label={`Coverage window for ${a.contractName}: ${a.serviceName}`}
                        className="w-60"
                        value={a.coverageWindowId}
                        disabled={assign.isPending}
                        onChange={(e) => assign.mutate({ id: a.id, input: { coverageWindowId: e.target.value } })}
                        options={options}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Problem error={assign.error} />
      </CardBody>
    </Card>
  );
}

/**
 * Business hours and holidays, so TTO and TTR count working time only:
 * coverage windows, holidays, and the window of each customer contract's
 * service. Kept in iTop by Combodo's business-hours extension, which must be
 * installed; administrators only.
 */
export function BusinessHoursPage() {
  const { data, isLoading, isError, error } = useBusinessHours();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Business hours' }]}
        title="Business hours"
        description="Open hours and holidays, so TTO and TTR count working time only."
      />

      {isError ? (
        <div role="alert" className="mb-6 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load business hours. {message(error) ?? ''}
        </div>
      ) : null}

      {isLoading || !data ? (
        isError ? null : <Skeleton className="h-64 w-full" />
      ) : !data.available ? (
        <div role="status" className="rounded-card border border-warning/30 bg-warning-soft px-4 py-3 text-[13px] text-ink">
          Business hours aren’t switched on for this iTop: it needs Combodo’s “SLA considering business hours” extension
          (modules combodo-sla-computation and combodo-coverage-windows-computation). Until then every TTO and TTR counts
          around the clock. See backend/README.md, “Business hours”.
        </div>
      ) : (
        <>
          <CoverageWindowsCard data={data} />
          <HolidaysCard data={data} />
          <AssignmentsCard data={data} />
        </>
      )}
    </>
  );
}

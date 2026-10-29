import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Clock, Copy, Gauge, Trash2 } from 'lucide-react';
import { Button, Card, CardBody, CardHeader, IconButton, Input, Skeleton } from '@/components/ui';
import { PriorityBadge, StatusPill } from '@/components/data-display';
import { cn, friendlyDateTime } from '@/lib/utils';
import type { TicketPriority } from '@/types/ticket';
import {
  useCancelTicket,
  useDeleteTime,
  useLogTime,
  useMarkDuplicate,
  useOverridePriority,
  useSuggestionsFor,
  useTicketHandling,
  useWorklog,
} from '../api/useTicketHandling';
import { formatMinutes, parseDuration, parseTicketRef, ticketPath, todayInput } from '../lib/format';
import type { HandledClass, TicketHandling } from '../types';
import { ErrorLine, Labelled, Notice, selectClass, textareaClass } from './shared';

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];
const label = (p: TicketPriority) => PRIORITIES.find((x) => x.value === p)?.label ?? p;

type Mode = 'none' | 'priority' | 'duplicate' | 'cancel' | 'time';

/* ------------------------------------------------------------------ forms */

function OverrideForm({ ticket, onDone }: { ticket: TicketHandling; onDone: () => void }) {
  const override = useOverridePriority(ticket.class, String(ticket.id));
  const [priority, setPriority] = useState<TicketPriority>(ticket.priority === 'critical' ? 'high' : 'critical');
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    override.mutate({ priority, reason: reason.trim() }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Override priority">
      <Labelled label="New priority" htmlFor="th-priority">
        <select id="th-priority" className={selectClass} value={priority} onChange={(e) => setPriority(e.target.value as TicketPriority)}>
          {PRIORITIES.filter((p) => p.value !== ticket.priority).map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </Labelled>
      <Labelled label="Reason (kept in the private log)" htmlFor="th-priority-reason">
        <textarea id="th-priority-reason" rows={2} className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} required />
      </Labelled>
      <p className="text-[12px] text-ink-muted">
        Priority comes from impact and urgency, so urgency (or, if needed, impact) is changed to give the new priority.
        Targets and queues follow it.
      </p>
      <ErrorLine error={override.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Back
        </Button>
        <Button type="submit" size="sm" loading={override.isPending} disabled={reason.trim().length < 3}>
          Override
        </Button>
      </div>
    </form>
  );
}

function DuplicateForm({ ticket, onDone }: { ticket: TicketHandling; onDone: () => void }) {
  const cls = ticket.class;
  const id = String(ticket.id);
  const mark = useMarkDuplicate(cls, id);
  const { data: suggestions, isLoading } = useSuggestionsFor(cls, id, true);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const chosen = parseTicketRef(typed, cls);
  const choose = (original: { class: HandledClass; id: number }) =>
    mark.mutate({ originalClass: original.class, originalId: original.id, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: onDone });

  return (
    <div className="space-y-3" aria-label="Mark as duplicate">
      <p className="text-[13px] text-ink-secondary">
        Pick the original. This {cls === 'Incident' ? 'incident' : 'request'} is then resolved with a note pointing to it.
      </p>
      <div>
        <p className="mb-1 text-[12.5px] font-medium text-ink-secondary">Likely originals</p>
        {isLoading ? (
          <Skeleton className="h-10" />
        ) : (suggestions?.items ?? []).length === 0 ? (
          <p className="text-[12.5px] text-ink-muted">Nothing open looks like this ticket.</p>
        ) : (
          <ul className="divide-y divide-line rounded-control border border-line" aria-label="Likely originals">
            {suggestions!.items.map((s) => (
              <li key={`${s.class}-${s.id}`} className="flex items-center justify-between gap-2 px-3 py-1.5 text-[13px]">
                <span className="min-w-0">
                  <Link to={ticketPath(s.class, s.id)} className="font-medium text-brand-ink hover:underline">
                    {s.ref}
                  </Link>{' '}
                  <span className="text-ink-secondary">{s.title}</span>
                  <span className="block text-[12px] text-ink-muted">{s.reasons.join(' · ')}</span>
                </span>
                <Button size="sm" variant="secondary" loading={mark.isPending && mark.variables?.originalId === s.id} onClick={() => choose(s)}>
                  Original
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Labelled label="Or the original's reference" htmlFor="th-original">
        <Input id="th-original" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="I-000123 or R-000045" />
      </Labelled>
      <Labelled label="Note (optional)" htmlFor="th-dup-note">
        <textarea id="th-dup-note" rows={2} className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} />
      </Labelled>
      <ErrorLine error={mark.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Back
        </Button>
        <Button size="sm" disabled={!chosen} loading={mark.isPending && !!chosen && mark.variables?.originalId === chosen.id} onClick={() => chosen && choose(chosen)}>
          Mark as duplicate
        </Button>
      </div>
    </div>
  );
}

function CancelForm({ ticket, onDone }: { ticket: TicketHandling; onDone: () => void }) {
  const cancel = useCancelTicket(ticket.class, String(ticket.id));
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    cancel.mutate(reason.trim(), { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Cancel ticket">
      <Labelled label="Why is it cancelled?" htmlFor="th-cancel-reason">
        <textarea id="th-cancel-reason" rows={2} className={textareaClass} value={reason} onChange={(e) => setReason(e.target.value)} required />
      </Labelled>
      <p className="text-[12px] text-ink-muted">The ticket is resolved with this reason and closed. It cannot be reopened.</p>
      <ErrorLine error={cancel.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Back
        </Button>
        <Button type="submit" size="sm" variant="danger" loading={cancel.isPending} disabled={reason.trim().length < 3}>
          Cancel ticket
        </Button>
      </div>
    </form>
  );
}

function LogTimeForm({ ticket, onDone }: { ticket: TicketHandling; onDone: () => void }) {
  const log = useLogTime(ticket.class, String(ticket.id));
  const [spent, setSpent] = useState('');
  const [note, setNote] = useState('');
  const [day, setDay] = useState(todayInput());
  const minutes = parseDuration(spent);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!minutes) return;
    log.mutate({ minutes, note: note.trim(), workDate: day }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Log time">
      <div className="grid grid-cols-2 gap-3">
        <Labelled label="Time spent" htmlFor="th-spent">
          <Input id="th-spent" value={spent} onChange={(e) => setSpent(e.target.value)} placeholder="45m, 1h 30m" />
        </Labelled>
        <Labelled label="Day" htmlFor="th-day">
          <Input id="th-day" type="date" value={day} max={todayInput()} onChange={(e) => setDay(e.target.value)} />
        </Labelled>
      </div>
      <Labelled label="What was done" htmlFor="th-note">
        <textarea id="th-note" rows={2} className={textareaClass} value={note} onChange={(e) => setNote(e.target.value)} required />
      </Labelled>
      {spent && !minutes ? <p className="text-[12.5px] text-critical-ink">Write the time as 45m, 1h 30m or 1:30.</p> : null}
      <ErrorLine error={log.error} />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Back
        </Button>
        <Button type="submit" size="sm" loading={log.isPending} disabled={!minutes || !note.trim()}>
          Log time
        </Button>
      </div>
    </form>
  );
}

/* --------------------------------------------------------------- worklog */

function Worklog({ ticket }: { ticket: TicketHandling }) {
  const { data } = useWorklog(ticket.class, String(ticket.id));
  const remove = useDeleteTime(ticket.class, String(ticket.id));
  if (!data || data.entries.length === 0) return null;
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] text-ink-secondary">
        <span className="font-semibold text-ink">{formatMinutes(data.totalMinutes)}</span> logged
        {data.byAgent.length > 0 ? ` · ${data.byAgent.map((a) => `${a.name} ${formatMinutes(a.minutes)}`).join(', ')}` : ''}
      </p>
      <ul className="divide-y divide-line rounded-control border border-line" aria-label="Time logged">
        {data.entries.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-2 px-3 py-1.5 text-[13px]">
            <span className="min-w-0">
              <span className="font-medium text-ink">{formatMinutes(e.minutes)}</span>{' '}
              <span className="text-ink-secondary">{e.note}</span>
              <span className="block text-[12px] text-ink-muted">
                {e.agent.name} · {e.workDate}
              </span>
            </span>
            {e.mine ? (
              <IconButton
                label={`Remove ${formatMinutes(e.minutes)} logged on ${e.workDate}`}
                icon={<Trash2 className="size-3.5" />}
                size="sm"
                onClick={() => remove.mutate(e.id)}
                disabled={remove.isPending}
              />
            ) : null}
          </li>
        ))}
      </ul>
      <ErrorLine error={remove.error} />
    </div>
  );
}

/* ----------------------------------------------------------------- panel */

/**
 * Override priority, mark as duplicate, cancel, and log time, for one
 * incident or user request; with what was done (override, duplicate,
 * cancellation) shown at the top.
 */
export function TicketHandlingPanel({ ticketClass, id, className }: { ticketClass: HandledClass; id: string; className?: string }) {
  const { data: ticket, isLoading, error } = useTicketHandling(ticketClass, id);
  const [mode, setMode] = useState<Mode>('none');
  const done = () => setMode('none');

  if (isLoading) return <Skeleton className={cn('h-28', className)} />;
  if (!ticket) {
    return error ? (
      <Card className={className}>
        <CardBody>
          <ErrorLine error={error} />
        </CardBody>
      </Card>
    ) : null;
  }

  const { can, override } = ticket;
  const actions: { mode: Mode; label: string; icon: typeof Gauge; show: boolean }[] = [
    { mode: 'priority', label: 'Override priority', icon: Gauge, show: can.overridePriority },
    { mode: 'duplicate', label: 'Mark as duplicate', icon: Copy, show: can.markDuplicate },
    { mode: 'time', label: 'Log time', icon: Clock, show: can.logTime },
    { mode: 'cancel', label: 'Cancel ticket', icon: Ban, show: can.cancel },
  ];

  return (
    <Card className={className}>
      <CardHeader
        title="Handling"
        subtitle={ticket.worklog.totalMinutes > 0 ? `${formatMinutes(ticket.worklog.totalMinutes)} logged` : undefined}
      />
      <CardBody className="space-y-3">
        {override ? (
          <Notice tone={override.active ? 'warning' : 'neutral'} title={override.active ? 'Priority overridden' : 'Earlier override'}>
            <span className="inline-flex flex-wrap items-center gap-1.5">
              <PriorityBadge priority={override.from} size="sm" /> → <PriorityBadge priority={override.to} size="sm" />
            </span>
            <p className="mt-1">{override.reason}</p>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              {override.by}, {friendlyDateTime(override.at)}
              {override.active ? '' : ` · no longer in force: impact or urgency were reassessed (now ${label(ticket.priority)})`}
            </p>
          </Notice>
        ) : null}

        {ticket.cancelled ? (
          <Notice title="Cancelled">
            <p>{ticket.cancelled.reason || 'No reason given.'}</p>
            <p className="mt-0.5 text-[12px] text-ink-muted">by {ticket.cancelled.by}</p>
          </Notice>
        ) : null}

        {ticket.duplicateOf ? (
          <Notice title="Duplicate of">
            <Link to={ticketPath(ticket.duplicateOf.class, ticket.duplicateOf.id)} className="font-medium text-brand-ink hover:underline">
              {ticket.duplicateOf.ref}
            </Link>{' '}
            {ticket.duplicateOf.title} <StatusPill status={ticket.duplicateOf.status} size="sm" />
          </Notice>
        ) : null}

        {ticket.duplicates.length > 0 ? (
          <Notice title={`Duplicates (${ticket.duplicates.length})`}>
            <ul className="space-y-0.5">
              {ticket.duplicates.map((d) => (
                <li key={`${d.class}-${d.id}`}>
                  <Link to={ticketPath(d.class, d.id)} className="font-medium text-brand-ink hover:underline">
                    {d.ref}
                  </Link>{' '}
                  <span className="text-ink-secondary">{d.title}</span>
                </li>
              ))}
            </ul>
          </Notice>
        ) : null}

        {mode === 'priority' ? (
          <OverrideForm ticket={ticket} onDone={done} />
        ) : mode === 'duplicate' ? (
          <DuplicateForm ticket={ticket} onDone={done} />
        ) : mode === 'cancel' ? (
          <CancelForm ticket={ticket} onDone={done} />
        ) : mode === 'time' ? (
          <LogTimeForm ticket={ticket} onDone={done} />
        ) : actions.some((a) => a.show) ? (
          <div className="flex flex-wrap gap-2">
            {actions
              .filter((a) => a.show)
              .map((a) => (
                <Button
                  key={a.mode}
                  size="sm"
                  variant={a.mode === 'cancel' ? 'ghost' : 'secondary'}
                  leadingIcon={<a.icon className="size-4" />}
                  onClick={() => setMode(a.mode)}
                >
                  {a.label}
                </Button>
              ))}
          </div>
        ) : null}

        {ticket.worklog.entries > 0 ? <Worklog ticket={ticket} /> : null}
      </CardBody>
    </Card>
  );
}

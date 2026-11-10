import { useState, type ReactNode } from 'react';
import { ChevronDown, FileText, Pencil, Plus, Search, Target, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Badge, Button, Card, Input, Select, Skeleton } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { longDate } from '@/lib/utils';
import {
  useAddContractService,
  useDeleteContract,
  useDeleteSla,
  useDeleteTarget,
  useRemoveContractService,
  useSaveContract,
  useSaveSla,
  useSaveTarget,
  useServiceLevels,
  useSetContractServiceSla,
} from '../api/useServiceLevels';
import type {
  ContractInput,
  ContractStatus,
  CustomerContract,
  PriorityCode,
  RequestTypeCode,
  ServiceLevelAgreement,
  ServiceLevels,
  ServiceTarget,
  SlaInput,
  SlaMetricCode,
  TargetInput,
  TimeUnit,
} from '../service-levels.types';

const message = (error: unknown) => (error instanceof Error ? error.message : undefined);

function Problem({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="mt-3 rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
      {message(error) ?? 'That did not work.'}
    </div>
  ) : null;
}

const PRIORITY: Record<PriorityCode, string> = { '1': 'P1 Critical', '2': 'P2 High', '3': 'P3 Medium', '4': 'P4 Low' };
const REQUEST_TYPE: Record<RequestTypeCode, string> = { incident: 'Incident', service_request: 'Service request' };
const METRIC: Record<SlaMetricCode, string> = { tto: 'Time to own (TTO)', ttr: 'Time to resolve (TTR)' };
const STATUS: Record<ContractStatus, string> = {
  implementation: 'Being set up',
  production: 'Active',
  obsolete: 'Ended',
};
const options = <K extends string>(labels: Record<K, string>) =>
  (Object.keys(labels) as K[]).map((value) => ({ value, label: labels[value] }));

/** "P1 Critical incident: resolve within 4 hours". */
export function describeTarget(t: Pick<ServiceTarget, 'requestType' | 'priority' | 'metric' | 'value' | 'unit'>) {
  const who = `${t.priority ? PRIORITY[t.priority] : 'Any priority'} ${t.requestType ? REQUEST_TYPE[t.requestType].toLowerCase() : 'ticket'}`;
  const what = t.metric === 'tto' ? 'own' : 'resolve';
  return `${who}: ${what} within ${t.value} ${t.value === 1 ? (t.unit || 'unit').replace(/s$/, '') : t.unit}`;
}

const field = 'text-[13px] text-ink-secondary';

/** Remembered per viewer, so the page opens the way it was left. */
function useRemembered(key: string, initial: boolean): [boolean, (open: boolean) => void] {
  const storageKey = `service-levels:${key}`;
  const [open, setOpen] = useState<boolean>(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      return saved === null ? initial : saved === '1';
    } catch {
      return initial;
    }
  });
  const set = (next: boolean) => {
    setOpen(next);
    try {
      window.localStorage.setItem(storageKey, next ? '1' : '0');
    } catch {
      /* private window: the open state is simply not kept */
    }
  };
  return [open, set];
}

/**
 * A card that folds: the header always shows the title and a one-line
 * summary, the body only when open. The action (New …) opens it too.
 */
function Section({
  id,
  title,
  summary,
  subtitle,
  actionLabel,
  onAction,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  subtitle: string;
  actionLabel: string;
  onAction: () => void;
  children: ReactNode;
}) {
  const [open, setOpen] = useRemembered(id, false);
  const bodyId = `section-${id}`;
  return (
    <Card className="mb-4">
      <div className="flex items-center gap-3 px-5 py-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 grow items-center gap-3 text-start"
        >
          <ChevronDown
            className={`size-4 shrink-0 text-ink-muted transition-transform duration-200 ${open ? '' : '-rotate-90 rtl:rotate-90'}`}
            aria-hidden
          />
          <span className="min-w-0">
            <span className="block text-[15px] leading-6 font-semibold text-ink">{title}</span>
            <span className="block text-[13px] text-ink-muted">{open ? subtitle : summary}</span>
          </span>
        </button>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            setOpen(true);
            onAction();
          }}
        >
          <Plus className="size-4" aria-hidden /> {actionLabel}
        </Button>
      </div>
      {open ? (
        <div id={bodyId} className="border-t border-line px-5 pt-4 pb-5">
          {children}
        </div>
      ) : null}
    </Card>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------------------------------- *
 * 1. Targets
 * ------------------------------------------------------------------------- */

const emptyTarget: TargetInput = { name: '', requestType: 'incident', priority: '1', metric: 'ttr', value: 4, unit: 'hours' };

function TargetForm({ initial, onDone }: { initial?: ServiceTarget; onDone: () => void }) {
  const save = useSaveTarget();
  const [draft, setDraft] = useState<TargetInput>(
    initial
      ? {
          name: initial.name,
          requestType: initial.requestType || 'incident',
          priority: initial.priority || '1',
          metric: initial.metric || 'ttr',
          value: initial.value,
          unit: initial.unit || 'hours',
        }
      : emptyTarget,
  );
  const set = (patch: Partial<TargetInput>) => setDraft((d) => ({ ...d, ...patch }));
  const name = draft.name.trim() || describeTarget(draft);

  return (
    <form
      aria-label={initial ? `Edit target ${initial.name}` : 'New target'}
      className="mb-4 flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface-sunken p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: initial?.id, input: { ...draft, name } }, { onSuccess: onDone });
      }}
    >
      <label className={field}>
        Ticket type
        <Select className="mt-1 w-40" value={draft.requestType} onChange={(e) => set({ requestType: e.target.value as RequestTypeCode })} options={options(REQUEST_TYPE)} />
      </label>
      <label className={field}>
        Priority
        <Select className="mt-1 w-36" value={draft.priority} onChange={(e) => set({ priority: e.target.value as PriorityCode })} options={options(PRIORITY)} />
      </label>
      <label className={field}>
        Measure
        <Select className="mt-1 w-48" value={draft.metric} onChange={(e) => set({ metric: e.target.value as SlaMetricCode })} options={options(METRIC)} />
      </label>
      <label className={field}>
        Within
        <Input
          type="number"
          min={1}
          step={1}
          className="mt-1 w-24"
          value={String(draft.value)}
          onChange={(e) => set({ value: Number(e.target.value) })}
          required
        />
      </label>
      <label className={field}>
        Unit
        <Select className="mt-1 w-28" value={draft.unit} onChange={(e) => set({ unit: e.target.value as TimeUnit })} options={[{ value: 'minutes', label: 'minutes' }, { value: 'hours', label: 'hours' }]} />
      </label>
      <label className={field}>
        Name (optional)
        <Input className="mt-1 w-64" value={draft.name} placeholder={describeTarget(draft)} onChange={(e) => set({ name: e.target.value })} maxLength={255} />
      </label>
      <Button type="submit" size="sm" disabled={!(draft.value > 0) || !Number.isInteger(draft.value)} loading={save.isPending}>
        {initial ? 'Save target' : 'Add target'}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>
        Cancel
      </Button>
      <div className="basis-full">
        <Problem error={save.error} />
      </div>
    </form>
  );
}

function TargetsCard({ data }: { data: ServiceLevels }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const remove = useDeleteTarget();
  const unused = data.targets.filter((t) => t.usedBy === 0).length;

  return (
    <Section
      id="targets"
      title="1. Targets"
      summary={
        data.targets.length
          ? `${plural(data.targets.length, 'target')}${unused ? ` · ${unused} not in any SLA` : ''}`
          : 'No targets yet'
      }
      subtitle="How fast a ticket must be owned (TTO) or resolved (TTR), for one ticket type and priority. SLAs group targets."
      actionLabel="New target"
      onAction={() => setEditing('new')}
    >
        {editing === 'new' ? <TargetForm onDone={() => setEditing(null)} /> : null}
        {data.targets.length === 0 && editing !== 'new' ? (
          <EmptyState icon={<Target className="size-5" />} title="No targets yet" description="Add one per ticket type, priority and measure, e.g. “P1 incident: resolve within 4 hours”." />
        ) : (
          <div className="ui-table-frame">
            <div className="overflow-x-auto">
              <table className="ui-table" aria-label="Targets">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>Ticket type</th>
                    <th>Priority</th>
                    <th>Measure</th>
                    <th>Within</th>
                    <th>In SLAs</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.targets.map((t) =>
                    editing === t.id ? (
                      <tr key={t.id}>
                        <td colSpan={7} className="py-2">
                          <TargetForm initial={t} onDone={() => setEditing(null)} />
                        </td>
                      </tr>
                    ) : (
                      <tr key={t.id}>
                        <td className="text-ink">{t.name}</td>
                        <td>{t.requestType ? REQUEST_TYPE[t.requestType] : '–'}</td>
                        <td>{t.priority ? PRIORITY[t.priority] : '–'}</td>
                        <td>{t.metric ? t.metric.toUpperCase() : '–'}</td>
                        <td className="tabular-nums">
                          {t.value} {t.unit}
                        </td>
                        <td className="tabular-nums text-ink-secondary">{t.usedBy}</td>
                        <td className="whitespace-nowrap py-2 text-end">
                          <Button variant="ghost" size="sm" aria-label={`Edit ${t.name}`} onClick={() => setEditing(t.id)}>
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Delete ${t.name}`}
                            onClick={() => {
                              const note = t.usedBy ? ` It is removed from ${t.usedBy} SLA${t.usedBy === 1 ? '' : 's'}.` : '';
                              if (window.confirm(`Delete the target “${t.name}”?${note}`)) remove.mutate(t.id);
                            }}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <Problem error={remove.error} />
    </Section>
  );
}

/* ------------------------------------------------------------------------- *
 * 2. SLAs
 * ------------------------------------------------------------------------- */

function SlaForm({ data, initial, onDone }: { data: ServiceLevels; initial?: ServiceLevelAgreement; onDone: () => void }) {
  const save = useSaveSla();
  const [draft, setDraft] = useState<SlaInput>({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    providerId: initial?.providerId ?? '',
    targetIds: initial?.targetIds ?? [],
  });
  const set = (patch: Partial<SlaInput>) => setDraft((d) => ({ ...d, ...patch }));
  const toggle = (id: string) =>
    set({ targetIds: draft.targetIds.includes(id) ? draft.targetIds.filter((t) => t !== id) : [...draft.targetIds, id] });

  return (
    <form
      aria-label={initial ? `Edit SLA ${initial.name}` : 'New SLA'}
      className="mb-4 rounded-card border border-line bg-surface-sunken p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: initial?.id, input: { ...draft, name: draft.name.trim() } }, { onSuccess: onDone });
      }}
    >
      <div className="flex flex-wrap items-end gap-2">
        <label className={field}>
          SLA name
          <Input className="mt-1 w-56" value={draft.name} onChange={(e) => set({ name: e.target.value })} required maxLength={255} placeholder="e.g. Gold support" />
        </label>
        <label className={field}>
          Provided by
          <Select
            className="mt-1 w-56"
            value={draft.providerId}
            onChange={(e) => set({ providerId: e.target.value })}
            options={[{ value: '', label: 'Choose an organisation' }, ...data.organizations.map((o) => ({ value: o.id, label: o.name }))]}
          />
        </label>
        <label className={`${field} grow`}>
          Description
          <Input className="mt-1 w-full" value={draft.description} onChange={(e) => set({ description: e.target.value })} />
        </label>
      </div>
      <fieldset className="mt-3">
        <legend className="mb-1 text-[13px] text-ink-secondary">Targets in this SLA</legend>
        {data.targets.length === 0 ? (
          <p className="text-[13px] text-ink-muted">Add targets in step 1 first.</p>
        ) : (
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
            {data.targets.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-[13px] text-ink">
                <input type="checkbox" checked={draft.targetIds.includes(t.id)} onChange={() => toggle(t.id)} />
                {t.name}
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="mt-3 flex gap-2">
        <Button type="submit" size="sm" disabled={!draft.name.trim() || !draft.providerId} loading={save.isPending}>
          {initial ? 'Save SLA' : 'Create SLA'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
      </div>
      <Problem error={save.error} />
    </form>
  );
}

function SlasCard({ data }: { data: ServiceLevels }) {
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const remove = useDeleteSla();
  const targetName = new Map(data.targets.map((t) => [t.id, t.name]));

  return (
    <Section
      id="slas"
      title="2. SLAs"
      summary={data.slas.length ? `${plural(data.slas.length, 'SLA')}: ${data.slas.map((s) => s.name).join(', ')}` : 'No SLAs yet'}
      subtitle="A named set of targets, such as Gold or Standard. Each service on a customer contract runs under one SLA."
      actionLabel="New SLA"
      onAction={() => setEditing('new')}
    >
        {editing === 'new' ? <SlaForm data={data} onDone={() => setEditing(null)} /> : null}
        {data.slas.length === 0 && editing !== 'new' ? (
          <EmptyState title="No SLAs yet" description="Create one and tick the targets it promises." />
        ) : (
          <ul className="divide-y divide-line" aria-label="SLAs">
            {data.slas.map((s) =>
              editing === s.id ? (
                <li key={s.id} className="py-2">
                  <SlaForm data={data} initial={s} onDone={() => setEditing(null)} />
                </li>
              ) : (
                <li key={s.id} className="flex flex-wrap items-start gap-3 py-3">
                  <div className="min-w-0 grow">
                    <p className="text-[14px] font-medium text-ink">{s.name}</p>
                    <p className="text-[12.5px] text-ink-secondary">
                      {s.providerName ? `Provided by ${s.providerName}` : 'No provider'} ·{' '}
                      {s.usedBy ? `${s.usedBy} contract service${s.usedBy === 1 ? '' : 's'}` : 'Not on any contract yet'}
                    </p>
                    {s.description ? <p className="mt-1 text-[13px] text-ink-secondary">{s.description}</p> : null}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {s.targetIds.length === 0 ? (
                        <Badge tone="warning">No targets: tickets get no deadline</Badge>
                      ) : (
                        s.targetIds.map((id) => <Badge key={id}>{targetName.get(id) ?? `Target ${id}`}</Badge>)
                      )}
                    </div>
                  </div>
                  <div className="whitespace-nowrap">
                    <Button variant="ghost" size="sm" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s.id)}>
                      <Pencil className="size-4" aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${s.name}`}
                      onClick={() => {
                        const note = s.usedBy
                          ? ` ${s.usedBy} contract service${s.usedBy === 1 ? '' : 's'} will have no SLA, so their new tickets get no deadline.`
                          : '';
                        if (window.confirm(`Delete the SLA “${s.name}”?${note}`)) remove.mutate(s.id);
                      }}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </div>
                </li>
              ),
            )}
          </ul>
        )}
        <Problem error={remove.error} />
    </Section>
  );
}

/* ------------------------------------------------------------------------- *
 * 3. Customer contracts
 * ------------------------------------------------------------------------- */

function ContractForm({ data, initial, onDone }: { data: ServiceLevels; initial?: CustomerContract; onDone: () => void }) {
  const save = useSaveContract();
  const [draft, setDraft] = useState<ContractInput>({
    name: initial?.name ?? '',
    customerId: initial?.customerId ?? '',
    providerId: initial?.providerId ?? '',
    status: initial?.status || 'production',
    startDate: initial?.startDate ?? '',
    endDate: initial?.endDate ?? '',
  });
  const set = (patch: Partial<ContractInput>) => setDraft((d) => ({ ...d, ...patch }));
  const orgs = [{ value: '', label: 'Choose an organisation' }, ...data.organizations.map((o) => ({ value: o.id, label: o.name }))];

  return (
    <form
      aria-label={initial ? `Edit contract ${initial.name}` : 'New contract'}
      className="mb-4 flex flex-wrap items-end gap-2 rounded-card border border-line bg-surface-sunken p-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: initial?.id, input: { ...draft, name: draft.name.trim() } }, { onSuccess: onDone });
      }}
    >
      <label className={field}>
        Contract name
        <Input className="mt-1 w-56" value={draft.name} onChange={(e) => set({ name: e.target.value })} required maxLength={255} />
      </label>
      <label className={field}>
        Customer
        <Select className="mt-1 w-52" value={draft.customerId} onChange={(e) => set({ customerId: e.target.value })} options={orgs} />
      </label>
      <label className={field}>
        Provider
        <Select className="mt-1 w-52" value={draft.providerId} onChange={(e) => set({ providerId: e.target.value })} options={orgs} />
      </label>
      <label className={field}>
        Status
        <Select className="mt-1 w-36" value={draft.status} onChange={(e) => set({ status: e.target.value as ContractStatus })} options={options(STATUS)} />
      </label>
      <label className={field}>
        Start
        <Input type="date" className="mt-1 w-40" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} />
      </label>
      <label className={field}>
        End
        <Input type="date" className="mt-1 w-40" value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} />
      </label>
      <Button type="submit" size="sm" disabled={!draft.name.trim() || !draft.customerId || !draft.providerId} loading={save.isPending}>
        {initial ? 'Save contract' : 'Create contract'}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onDone}>
        Cancel
      </Button>
      <div className="basis-full">
        <Problem error={save.error} />
      </div>
    </form>
  );
}

function AddServiceForm({ data, contract }: { data: ServiceLevels; contract: CustomerContract }) {
  const add = useAddContractService();
  const [serviceId, setServiceId] = useState('');
  const [slaId, setSlaId] = useState(data.slas.length === 1 ? data.slas[0]!.id : '');
  const taken = new Set(contract.services.map((s) => s.serviceId));
  const free = data.services.filter((s) => !taken.has(s.id));
  if (free.length === 0) return null;

  return (
    <form
      aria-label={`Add a service to ${contract.name}`}
      className="mt-2 flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        add.mutate({ contractId: contract.id, serviceId, slaId }, { onSuccess: () => setServiceId('') });
      }}
    >
      <label className={field}>
        Service
        <Select
          className="mt-1 w-56"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          options={[{ value: '', label: 'Choose a service' }, ...free.map((s) => ({ value: s.id, label: s.name }))]}
        />
      </label>
      <label className={field}>
        SLA
        <Select
          className="mt-1 w-48"
          value={slaId}
          onChange={(e) => setSlaId(e.target.value)}
          options={[{ value: '', label: 'No SLA' }, ...data.slas.map((s) => ({ value: s.id, label: s.name }))]}
        />
      </label>
      <Button type="submit" size="sm" variant="secondary" disabled={!serviceId} loading={add.isPending}>
        <Plus className="size-4" aria-hidden /> Add service
      </Button>
      <div className="basis-full">
        <Problem error={add.error} />
      </div>
    </form>
  );
}

function ContractBlock({
  data,
  contract,
  open,
  onToggle,
}: {
  data: ServiceLevels;
  contract: CustomerContract;
  open: boolean;
  onToggle: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const setSla = useSetContractServiceSla();
  const removeService = useRemoveContractService();
  const remove = useDeleteContract();
  const slaOptions = [{ value: '', label: 'No SLA (no deadline)' }, ...data.slas.map((s) => ({ value: s.id, label: s.name }))];

  if (editing) return <ContractForm data={data} initial={contract} onDone={() => setEditing(false)} />;

  const dates = [contract.startDate && `from ${longDate(`${contract.startDate}T12:00:00`)}`, contract.endDate && `to ${longDate(`${contract.endDate}T12:00:00`)}`]
    .filter(Boolean)
    .join(' ');

  const withoutSla = contract.services.filter((l) => !l.slaId).length;
  const bodyId = `contract-${contract.id}`;

  return (
    <section aria-label={`Contract ${contract.name}`} className="rounded-card border border-line">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex min-w-0 grow items-center gap-3 text-start"
        >
          <ChevronDown
            className={`size-4 shrink-0 text-ink-muted transition-transform duration-200 ${open ? '' : '-rotate-90 rtl:rotate-90'}`}
            aria-hidden
          />
          <span className="min-w-0 grow">
            <span className="flex flex-wrap items-center gap-2 text-[14px] font-medium text-ink">
              {contract.customerName || 'No customer'}
              <span className="font-normal text-ink-secondary">· {contract.name}</span>
              {contract.status ? (
                <Badge tone={contract.status === 'production' ? 'good' : contract.status === 'obsolete' ? 'neutral' : 'info'}>
                  {STATUS[contract.status]}
                </Badge>
              ) : null}
            </span>
            <span className="block truncate text-[12.5px] text-ink-secondary">
              {contract.providerName ? `Provided by ${contract.providerName}` : 'No provider'}
              {dates ? ` · ${dates}` : ''}
            </span>
          </span>
          <span className="hidden shrink-0 items-center gap-1.5 sm:flex">
            <Badge>{plural(contract.services.length, 'service')}</Badge>
            {withoutSla ? <Badge tone="warning">{withoutSla} without SLA</Badge> : null}
          </span>
        </button>
        <div className="shrink-0 whitespace-nowrap">
          <Button variant="ghost" size="sm" aria-label={`Edit ${contract.name}`} onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Delete ${contract.name}`}
            onClick={() => {
              if (window.confirm(`Delete the contract “${contract.name}” and its ${contract.services.length} service line(s)? Tickets of ${contract.customerName || 'this customer'} then get no deadline.`)) {
                remove.mutate(contract.id);
              }
            }}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>

      {open ? (
        <div id={bodyId} className="border-t border-line px-3 pt-2 pb-3">
          {contract.services.length === 0 ? (
            <p className="mt-2 text-[13px] text-warning-ink">No services yet: this customer’s tickets get no SLA deadline.</p>
          ) : (
            <div className="ui-table-frame mt-2">
              <div className="overflow-x-auto">
                <table className="ui-table" aria-label={`Services on ${contract.name}`}>
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>SLA</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {contract.services.map((line) => (
                      <tr key={line.id}>
                        <td className="text-ink">{line.serviceName}</td>
                        <td className="py-2">
                          <Select
                            aria-label={`SLA for ${contract.name}: ${line.serviceName}`}
                            className="w-60"
                            value={line.slaId}
                            disabled={setSla.isPending}
                            onChange={(e) => setSla.mutate({ id: line.id, slaId: e.target.value })}
                            options={slaOptions}
                          />
                        </td>
                        <td className="py-2 text-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove ${line.serviceName} from ${contract.name}`}
                            onClick={() => removeService.mutate(line.id)}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <AddServiceForm data={data} contract={contract} />
        </div>
      ) : null}
      <div className="px-3">
        <Problem error={setSla.error ?? removeService.error ?? remove.error} />
      </div>
    </section>
  );
}

function ContractsCard({ data }: { data: ServiceLevels }) {
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setOpenIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const term = query.trim().toLowerCase();
  const shown = term
    ? data.contracts.filter((c) =>
        [c.name, c.customerName, c.providerName, ...c.services.map((l) => `${l.serviceName} ${l.slaName}`)]
          .join(' ')
          .toLowerCase()
          .includes(term),
      )
    : data.contracts;
  const lines = data.contracts.reduce((n, c) => n + c.services.length, 0);
  const withoutSla = data.contracts.reduce((n, c) => n + c.services.filter((l) => !l.slaId).length, 0);
  const allOpen = shown.length > 0 && shown.every((c) => openIds.has(c.id));

  return (
    <Section
      id="contracts"
      title="3. Customer contracts"
      summary={
        data.contracts.length
          ? `${plural(data.contracts.length, 'contract')} · ${plural(lines, 'service')}${withoutSla ? ` · ${withoutSla} without SLA` : ''}`
          : 'No customer contracts yet'
      }
      subtitle="A customer’s contract lists the services they get and the SLA of each. A ticket gets its deadline from its caller’s organisation, its service, and that line’s SLA."
      actionLabel="New contract"
      onAction={() => setCreating(true)}
    >
      {creating ? <ContractForm data={data} onDone={() => setCreating(false)} /> : null}
      {data.contracts.length === 0 && !creating ? (
        <EmptyState icon={<FileText className="size-5" />} title="No customer contracts yet" description="Create one per customer, then add its services with their SLA." />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a customer, contract or service…"
              aria-label="Find a contract"
              leadingIcon={<Search className="size-4" />}
              className="w-full sm:w-80"
            />
            <Button variant="ghost" size="sm" onClick={() => setOpenIds(allOpen ? new Set() : new Set(shown.map((c) => c.id)))}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          </div>
          {shown.length === 0 ? (
            <p className="py-4 text-center text-[13px] text-ink-muted">No contract matches “{query.trim()}”.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {shown.map((c) => (
                <ContractBlock
                  key={c.id}
                  data={data}
                  contract={c}
                  open={openIds.has(c.id) || shown.length === 1}
                  onToggle={() => toggle(c.id)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

/**
 * Service levels in one place: the targets, the SLAs that group them, and
 * each customer contract's services with the SLA they run under, which is
 * what gives a ticket its TTO and TTR deadlines. Administrators only.
 */
export function ServiceLevelsPage() {
  const { data, isLoading, isError, error } = useServiceLevels();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Service levels' }]}
        title="Service levels"
        description="Targets, SLAs, and the SLA each customer contract’s service runs under. Open hours and holidays are under Business hours."
      />

      {isError ? (
        <div role="alert" className="mb-6 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
          Couldn’t load service levels. {message(error) ?? ''}
        </div>
      ) : null}

      {isLoading || !data ? (
        isError ? null : <Skeleton className="h-64 w-full" />
      ) : (
        <>
          <TargetsCard data={data} />
          <SlasCard data={data} />
          <ContractsCard data={data} />
        </>
      )}
    </>
  );
}

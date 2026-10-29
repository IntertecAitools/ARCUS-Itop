import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';

import { PageHeader } from '@/components/layout';
import { EmptyState } from '@/components/feedback';
import { Badge, Button, buttonClasses, Card, CardBody, CardHeader, Input, Select, Skeleton } from '@/components/ui';
import { humaniseAttcode, useClassInfo } from '@/features/records';
import {
  useDeleteSyncSource,
  useImportClasses,
  useReadFile,
  useRunSyncSource,
  useSaveSyncSource,
  useSyncLog,
  useSyncSource,
  useSyncSources,
} from '../api/useDataImport';
import { duration, fileToBase64, suggestSyncColumns, syncTargets } from '../lib/wizard';
import type {
  DeletePolicy,
  SyncLogSummary,
  SyncRunResult,
  SyncSource,
  SyncSourceDetail,
  SyncSourceInput,
  UploadedTable,
} from '../types';

const message = (error: unknown) => (error instanceof Error ? error.message : 'That did not work.');

function Problem({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="mt-3 rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
      {message(error)}
    </div>
  ) : null;
}

const CRUMBS = [
  { label: 'Home', to: '/' },
  { label: 'Data import', to: '/data-import' },
  { label: 'Sync sources', to: '/data-import/sync-sources' },
];

const DELETE_POLICIES: { value: DeletePolicy; label: string }[] = [
  { value: 'ignore', label: 'Leave it as it is' },
  { value: 'update', label: 'Update it (e.g. mark obsolete)' },
  { value: 'delete', label: 'Delete it' },
  { value: 'update_then_delete', label: 'Update it, then delete it later' },
];

function RunBadge({ run }: { run?: SyncLogSummary }) {
  if (!run) return <Badge size="sm">Never run</Badge>;
  const tone = run.status === 'error' ? 'critical' : run.errors > 0 ? 'warning' : run.status === 'running' ? 'info' : 'good';
  const label = run.status === 'completed' && run.errors > 0 ? `completed, ${run.errors} errors` : run.status;
  return (
    <Badge tone={tone} size="sm">
      {label}
    </Badge>
  );
}

/**
 * Recurring feeds, kept as iTop Data Synchro sources: each says which class
 * it fills, how a row finds its record, and what happens to records that
 * leave the feed. A run loads a file and synchronizes; iTop logs each one.
 */
export function SyncSourcesPage() {
  const sources = useSyncSources();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const list = sources.data?.sources ?? [];

  return (
    <>
      <PageHeader
        breadcrumbs={[...CRUMBS.slice(0, 2), { label: 'Sync sources' }]}
        title="Sync sources"
        description="Feeds that keep records in step with another system: HR for people, discovery for CIs. Each run loads the feed's file; records that leave the feed are handled as the source says."
        actions={
          <div className="flex gap-2">
            <Link to="/data-import" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              <ArrowLeft className="me-1.5 size-4 rtl:-scale-x-100" />
              Data import
            </Link>
            {!creating ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                New source
              </Button>
            ) : null}
          </div>
        }
      />

      {creating ? (
        <Card className="mb-4">
          <CardHeader title="New sync source" />
          <CardBody>
            <SyncSourceForm onCancel={() => setCreating(false)} onSaved={(s) => navigate(`/data-import/sync-sources/${s.id}`)} />
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          {sources.isLoading ? (
            <Skeleton className="h-24" />
          ) : list.length === 0 ? (
            <EmptyState
              icon={<RefreshCw className="size-5" />}
              title="No sync sources yet"
              description="Define one for each system that feeds records in on a schedule."
            />
          ) : (
            <ul className="divide-y divide-line" aria-label="Sync sources">
              {list.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <Link to={`/data-import/sync-sources/${s.id}`} className="font-medium text-brand-ink hover:underline">
                      {s.name}
                    </Link>
                    <p className="text-[13px] text-ink-secondary">
                      {s.targetClass} · {s.status}
                      {s.lastRun ? ` · last run ${s.lastRun.endDate || s.lastRun.startDate}` : ''}
                    </p>
                  </div>
                  <RunBadge run={s.lastRun} />
                </li>
              ))}
            </ul>
          )}
          <Problem error={sources.error} />
        </CardBody>
      </Card>
    </>
  );
}

/** One source: its settings, a run from a file, and its runs with iTop's log. */
export function SyncSourcePage() {
  const { id = '' } = useParams();
  const source = useSyncSource(id);
  const remove = useDeleteSyncSource();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [logId, setLogId] = useState<number | null>(null);
  const data = source.data;

  if (!data) {
    return (
      <>
        <PageHeader breadcrumbs={CRUMBS} title="Loading…" />
        {source.error ? <Problem error={source.error} /> : <Skeleton className="h-96" />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        breadcrumbs={[...CRUMBS, { label: data.name }]}
        title={data.name}
        description={data.description || `Feeds ${data.targetClass} records.`}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="size-4" aria-hidden />
              Edit
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={remove.isPending}
              onClick={() => {
                if (window.confirm(`Delete the sync source “${data.name}”? The records it made stay.`)) {
                  remove.mutate(String(data.id), { onSuccess: () => navigate('/data-import/sync-sources') });
                }
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          </div>
        }
      />
      <Problem error={remove.error} />

      {editing ? (
        <Card className="mb-4">
          <CardHeader title="Edit source" />
          <CardBody>
            <SyncSourceForm source={data} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />
          </CardBody>
        </Card>
      ) : (
        <SettingsCard source={data} />
      )}

      <RunCard source={data} onRan={(result) => result.log && setLogId(result.log.id)} />

      <Card className="mb-4">
        <CardHeader title="Runs" subtitle="iTop's log of each synchronization, newest first." />
        <CardBody>
          {data.logs.length === 0 ? (
            <p className="text-[13px] text-ink-muted">Not run yet.</p>
          ) : (
            <table className="w-full text-start text-[13px]">
              <thead className="text-[12px] text-ink-muted">
                <tr>
                  <th className="py-1 pe-3 font-medium">Started</th>
                  <th className="py-1 pe-3 font-medium">Status</th>
                  <th className="py-1 pe-3 font-medium">Rows seen</th>
                  <th className="py-1 pe-3 font-medium">Created</th>
                  <th className="py-1 pe-3 font-medium">Updated</th>
                  <th className="py-1 pe-3 font-medium">Deleted / obsoleted</th>
                  <th className="py-1 pe-3 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.logs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-1.5 pe-3">{log.startDate}</td>
                    <td className="py-1.5 pe-3">
                      <RunBadge run={log} />
                    </td>
                    <td className="py-1.5 pe-3 tabular-nums">
                      {log.replicasSeen} / {log.replicasTotal}
                    </td>
                    <td className="py-1.5 pe-3 tabular-nums">{log.created}</td>
                    <td className="py-1.5 pe-3 tabular-nums">{log.updated}</td>
                    <td className="py-1.5 pe-3 tabular-nums">
                      {log.deleted} / {log.obsoleted}
                    </td>
                    <td className="py-1.5 pe-3">
                      <button type="button" className="text-brand-ink hover:underline" onClick={() => setLogId(log.id)}>
                        Log
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {logId ? <LogView sourceId={String(data.id)} logId={logId} /> : null}
        </CardBody>
      </Card>
    </>
  );
}

function SettingsCard({ source }: { source: SyncSourceDetail }) {
  const written = source.attributes.filter((a) => a.update);
  const keys = source.attributes.filter((a) => a.reconcile);
  const policy = DELETE_POLICIES.find((p) => p.value === source.deletePolicy)?.label ?? source.deletePolicy;
  const rows: [string, string][] = [
    ['Records', source.targetClass],
    ['Status', source.status],
    [
      'Matched on',
      source.reconciliationPolicy === 'use_primary_key'
        ? 'the feed’s own id only'
        : keys.map((a) => a.attcode + (a.lookup ? ` (by ${a.lookup})` : '')).join(', ') || '—',
    ],
    ['Writes', written.map((a) => a.attcode + (a.lookup ? ` (by ${a.lookup})` : '')).join(', ') || '—'],
    ['No match', source.actionOnZero === 'create' ? 'create a record' : 'report an error'],
    ['Several matches', { take_first: 'use the first', create: 'create a record', error: 'report an error' }[source.actionOnMultiple]],
    [
      'Record leaves the feed',
      policy +
        (source.deletePolicyUpdate ? ` (${source.deletePolicyUpdate})` : '') +
        (source.deletePolicy === 'update_then_delete' ? `, deleted after ${duration(source.deletePolicyRetention)}` : ''),
    ],
    ['Full load expected every', duration(source.fullLoadPeriodicity)],
    ['Runs as', source.user || '—'],
  ];
  return (
    <Card className="mb-4">
      <CardHeader title="Settings" />
      <CardBody>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-[13px] sm:grid-cols-[max-content_1fr]">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

/** Fields of the target class a feed can write, by code. */
function useWritableFields(className: string) {
  const { data: info } = useClassInfo(className);
  return useMemo(() => {
    if (!info) return [];
    return info.writable
      .filter((code) => {
        const spec = info.fields[code];
        return spec && (spec.ui === 'scalar' || spec.ui === 'picker') && spec.type !== 'CaseLog';
      })
      .map((code) => ({
        code,
        label: info.labels?.fields?.[code] ?? humaniseAttcode(code),
        target: info.fields[code]?.ui === 'picker' ? info.fields[code]?.target : undefined,
      }));
  }, [info]);
}

/** The field a reference column names its record by, in a feed: Person by email, the rest by name. */
const defaultLookup = (target?: string) => (target === 'Person' || target === 'Contact' ? 'email' : 'name');

function SyncSourceForm({
  source,
  onCancel,
  onSaved,
}: {
  source?: SyncSourceDetail;
  onCancel: () => void;
  onSaved: (saved: SyncSourceDetail) => void;
}) {
  const classes = useImportClasses();
  const save = useSaveSyncSource();
  const [name, setName] = useState(source?.name ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [targetClass, setTargetClass] = useState(source?.targetClass ?? '');
  const [status, setStatus] = useState(source?.status ?? 'implementation');
  const [columns, setColumns] = useState<string[]>(source?.attributes.filter((a) => a.update).map((a) => a.attcode) ?? []);
  const [keys, setKeys] = useState<string[]>(source?.attributes.filter((a) => a.reconcile).map((a) => a.attcode) ?? []);
  const [lookups, setLookups] = useState<Record<string, string>>(
    Object.fromEntries(source?.attributes.filter((a) => a.lookup !== undefined).map((a) => [a.attcode, a.lookup!]) ?? []),
  );
  const [deletePolicy, setDeletePolicy] = useState<DeletePolicy>(source?.deletePolicy ?? 'ignore');
  const [deletePolicyUpdate, setDeletePolicyUpdate] = useState(source?.deletePolicyUpdate ?? 'status:obsolete');
  const [retentionDays, setRetentionDays] = useState(String((source?.deletePolicyRetention ?? 0) / 86_400 || 30));
  const [actionOnMultiple, setActionOnMultiple] = useState(source?.actionOnMultiple ?? 'error');
  const fields = useWritableFields(targetClass);

  const toggle = (list: string[], set: (next: string[]) => void, code: string) =>
    set(list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);

  const input = (): SyncSourceInput => ({
    name,
    description,
    status,
    targetClass,
    keys: keys.filter((k) => columns.includes(k)),
    columns,
    lookups: Object.fromEntries(
      fields.filter((f) => f.target && columns.includes(f.code)).map((f) => [f.code, lookups[f.code] ?? defaultLookup(f.target)]),
    ),
    actionOnMultiple,
    deletePolicy,
    ...(deletePolicy === 'update' || deletePolicy === 'update_then_delete' ? { deletePolicyUpdate } : {}),
    ...(deletePolicy === 'update_then_delete' ? { deletePolicyRetention: Math.round(Number(retentionDays) * 86_400) } : {}),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ id: source ? String(source.id) : undefined, input: input() }, { onSuccess: onSaved });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[13px] text-ink">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} required aria-label="Source name" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-ink">
          Records
          <Select
            aria-label="Target class"
            value={targetClass}
            disabled={Boolean(source)}
            onChange={(e) => {
              setTargetClass(e.target.value);
              setColumns([]);
              setKeys([]);
            }}
            options={[
              { value: '', label: 'Choose…' },
              ...(classes.data?.classes ?? []).map((c) => ({ value: c.name, label: c.label })),
            ]}
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-ink sm:col-span-2">
          Description
          <Input value={description} onChange={(e) => setDescription(e.target.value)} aria-label="Description" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-ink">
          Status
          <Select
            aria-label="Status"
            value={status}
            onChange={(e) => setStatus(e.target.value as SyncSource['status'])}
            options={[
              { value: 'implementation', label: 'Implementation (being set up)' },
              { value: 'production', label: 'Production' },
              { value: 'obsolete', label: 'Obsolete (no longer runs)' },
            ]}
          />
        </label>
        <label className="flex flex-col gap-1 text-[13px] text-ink">
          When several records match a row
          <Select
            aria-label="When several records match"
            value={actionOnMultiple}
            onChange={(e) => setActionOnMultiple(e.target.value as SyncSource['actionOnMultiple'])}
            options={[
              { value: 'error', label: 'Report an error' },
              { value: 'take_first', label: 'Use the first' },
              { value: 'create', label: 'Create a record' },
            ]}
          />
        </label>
      </div>

      {fields.length > 0 ? (
        <fieldset>
          <legend className="mb-2 text-[13px] font-medium text-ink">Columns the feed provides</legend>
          <table className="w-full text-start text-[13px]">
            <thead className="text-[12px] text-ink-muted">
              <tr>
                <th className="py-1 pe-3 font-medium">Field</th>
                <th className="py-1 pe-3 font-medium">In the feed</th>
                <th className="py-1 pe-3 font-medium">Match on</th>
                <th className="py-1 pe-3 font-medium">Reference given by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {fields.map((f) => (
                <tr key={f.code}>
                  <td className="py-1 pe-3">
                    {f.label} <span className="font-mono text-[11px] text-ink-muted">{f.code}</span>
                  </td>
                  <td className="py-1 pe-3">
                    <input
                      type="checkbox"
                      aria-label={`${f.code} in the feed`}
                      checked={columns.includes(f.code)}
                      onChange={() => toggle(columns, setColumns, f.code)}
                    />
                  </td>
                  <td className="py-1 pe-3">
                    <input
                      type="checkbox"
                      aria-label={`Match on ${f.code}`}
                      disabled={!columns.includes(f.code)}
                      checked={keys.includes(f.code) && columns.includes(f.code)}
                      onChange={() => toggle(keys, setKeys, f.code)}
                    />
                  </td>
                  <td className="py-1 pe-3">
                    {f.target && columns.includes(f.code) ? (
                      <Select
                        aria-label={`${f.code} given by`}
                        className="h-8 w-40"
                        value={lookups[f.code] ?? defaultLookup(f.target)}
                        onChange={(e) => setLookups({ ...lookups, [f.code]: e.target.value })}
                        options={[
                          { value: defaultLookup(f.target), label: `its ${defaultLookup(f.target)}` },
                          { value: '', label: 'its id' },
                        ]}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </fieldset>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-[13px] text-ink">
          When a record leaves the feed
          <Select
            aria-label="When a record leaves the feed"
            value={deletePolicy}
            onChange={(e) => setDeletePolicy(e.target.value as DeletePolicy)}
            options={DELETE_POLICIES}
          />
        </label>
        {deletePolicy === 'update' || deletePolicy === 'update_then_delete' ? (
          <label className="flex flex-col gap-1 text-[13px] text-ink">
            Set
            <Input value={deletePolicyUpdate} onChange={(e) => setDeletePolicyUpdate(e.target.value)} aria-label="Fields to set" />
          </label>
        ) : null}
        {deletePolicy === 'update_then_delete' ? (
          <label className="flex flex-col gap-1 text-[13px] text-ink">
            Delete after (days)
            <Input type="number" min={1} value={retentionDays} onChange={(e) => setRetentionDays(e.target.value)} aria-label="Delete after days" />
          </label>
        ) : null}
      </div>

      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={save.isPending} disabled={!name.trim() || !targetClass || columns.length === 0}>
          {source ? 'Save' : 'Create source'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <Problem error={save.error} />
    </form>
  );
}

function RunCard({ source, onRan }: { source: SyncSourceDetail; onRan: (result: SyncRunResult) => void }) {
  const read = useReadFile();
  const run = useRunSyncSource();
  const [table, setTable] = useState<UploadedTable | null>(null);
  const [columns, setColumns] = useState<(string | null)[]>([]);
  const [result, setResult] = useState<SyncRunResult | null>(null);
  const targets = syncTargets(source.attributes);

  const go = (simulate: boolean) =>
    run.mutate(
      { id: String(source.id), request: { columns, rows: table?.rows ?? [], simulate } },
      {
        onSuccess: (r) => {
          setResult(r);
          onRan(r);
        },
      },
    );

  return (
    <Card className="mb-4">
      <CardHeader
        title="Run from a file"
        subtitle="Load the feed's file and synchronize. Map one column to primary_key: the feed's own id for each row, which iTop keeps to recognise it next time."
      />
      <CardBody className="space-y-3">
        <input
          type="file"
          accept=".csv,.xlsx"
          aria-label="Feed file"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setResult(null);
            read.mutate(
              { fileName: file.name, content: await fileToBase64(file) },
              {
                onSuccess: (t) => {
                  setTable(t);
                  setColumns(suggestSyncColumns(t.headings, targets));
                },
              },
            );
          }}
        />
        {table ? (
          <table className="w-full max-w-xl text-start text-[13px]">
            <thead className="text-[12px] text-ink-muted">
              <tr>
                <th className="py-1 pe-3 font-medium">Column in file</th>
                <th className="py-1 pe-3 font-medium">Source column</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {table.headings.map((heading, index) => (
                <tr key={index}>
                  <td className="py-1 pe-3 font-mono text-[12px]">{heading}</td>
                  <td className="py-1 pe-3">
                    <Select
                      aria-label={`Source column for ${heading}`}
                      className="h-8"
                      value={columns[index] ?? ''}
                      onChange={(e) => {
                        const next = [...columns];
                        next[index] = e.target.value || null;
                        setColumns(next);
                        setResult(null);
                      }}
                      options={[{ value: '', label: '— Skip —' }, ...targets.map((t) => ({ value: t, label: t }))]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {table ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" loading={run.isPending && run.variables?.request.simulate} onClick={() => go(true)}>
              Simulate
            </Button>
            <Button size="sm" loading={run.isPending && run.variables?.request.simulate === false} onClick={() => go(false)}>
              Run sync
            </Button>
            <span className="text-[12px] text-ink-muted">{table.rows.length.toLocaleString()} rows</span>
          </div>
        ) : null}
        <Problem error={read.error ?? run.error} />
        {result ? (
          <div className="rounded-card border border-line p-3 text-[13px]">
            <p className="mb-2 font-medium text-ink">{result.simulated ? 'Simulation — rolled back, nothing kept' : 'Sync finished'}</p>
            <dl className="grid grid-cols-[max-content_auto] gap-x-4 gap-y-0.5">
              {Object.entries(result.counts).map(([label, n]) => (
                <div key={label} className="contents">
                  <dt className="text-ink-muted">{label}</dt>
                  <dd className="tabular-nums text-ink">{n}</dd>
                </div>
              ))}
            </dl>
            {result.messages.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-critical-ink">
                {result.messages.slice(0, 50).map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function LogView({ sourceId, logId }: { sourceId: string; logId: number }) {
  const log = useSyncLog(sourceId, logId);
  if (log.isLoading) return <Skeleton className="mt-3 h-24" />;
  if (!log.data) return <Problem error={log.error} />;
  return (
    <div className="mt-3 rounded-card border border-line p-3 text-[13px]" aria-label="Run log">
      <p className="mb-1 font-medium text-ink">
        Run {log.data.id}: {log.data.startDate} → {log.data.endDate || 'running'}
      </p>
      {log.data.lastError ? <p className="mb-1 text-critical-ink">{log.data.lastError}</p> : null}
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-[12px] text-ink-secondary">
        {log.data.traces || 'No trace kept (iTop keeps one when its synchro_trace setting is on).'}
      </pre>
    </div>
  );
}

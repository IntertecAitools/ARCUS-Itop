import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, RefreshCw, Upload } from 'lucide-react';

import { PageHeader } from '@/components/layout';
import { Badge, Button, buttonClasses, Card, CardBody, CardHeader, Select, Skeleton } from '@/components/ui';
import {
  MappingCard,
  mappedColumns,
  saveBlob,
  suggestMapping,
  useClassInfo,
  type ImportMapping,
} from '@/features/records';
import { downloadReport } from '../api/data-import.api';
import {
  useImportClasses,
  useImportReports,
  usePreviewImport,
  useReadFile,
  useRunImport,
} from '../api/useDataImport';
import { ACTION_LABEL, defaultKeys, fileToBase64, LOOKUPS, OUTCOME_LABEL, TONE } from '../lib/wizard';
import type { ImportPlan, ImportReport, ImportRequest, PlannedAction, UploadedTable } from '../types';

const message = (error: unknown) => (error instanceof Error ? error.message : 'That did not work.');

function Problem({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink">
      {message(error)}
    </div>
  ) : null;
}

/** Rows shown at once in a preview or report; the download has them all. */
const SHOWN = 200;

/**
 * The admin import wizard: pick what to load, upload a CSV or Excel file,
 * map its columns to fields, say which columns find an existing record,
 * preview what every row would do, then run it. The BFF writes through
 * iTop's REST API as the signed-in admin, so iTop's rights and the
 * tenant's organisations apply; each run's report is kept to download.
 */
export function DataImportPage() {
  const classes = useImportClasses();
  const [className, setClassName] = useState('');
  const cls = classes.data?.classes.find((c) => c.name === className);
  const { data: info } = useClassInfo(className);

  const read = useReadFile();
  const preview = usePreviewImport();
  const run = useRunImport();

  const [table, setTable] = useState<UploadedTable | null>(null);
  const [editedMapping, setEditedMapping] = useState<ImportMapping | null>(null);
  const [editedKeys, setEditedKeys] = useState<string[] | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  const suggested = useMemo(
    () => (info && table ? suggestMapping(info, table.headings, LOOKUPS) : []),
    [info, table],
  );
  const mapping = editedMapping ?? suggested;
  const columns = mappedColumns(mapping);
  const keys = (editedKeys ?? defaultKeys(cls, columns)).filter((k) => columns.includes(k));

  const request = (): ImportRequest => ({
    fileName: table?.fileName ?? '',
    columns: mapping,
    rows: table?.rows ?? [],
    keys,
  });

  /** Anything that changes what would be written makes the preview stale. */
  const stale = () => {
    setPlan(null);
    setReport(null);
    preview.reset();
    run.reset();
  };

  const chooseClass = (name: string) => {
    setClassName(name);
    setEditedMapping(null);
    setEditedKeys(null);
    stale();
  };

  const upload = async (file: File) => {
    setTable(null);
    setEditedMapping(null);
    setEditedKeys(null);
    stale();
    read.mutate({ fileName: file.name, content: await fileToBase64(file) }, { onSuccess: setTable });
  };

  const mapColumn = (index: number, target: string | null) => {
    const next = [...mapping];
    if (target !== null) next.forEach((t, i) => t === target && (next[i] = null));
    next[index] = target;
    setEditedMapping(next);
    stale();
  };

  const toggleKey = (column: string) => {
    setEditedKeys(keys.includes(column) ? keys.filter((k) => k !== column) : [...keys, column]);
    stale();
  };

  const ready = Boolean(className && table && columns.length > 0);
  const toWrite = plan ? plan.summary.create + plan.summary.update : 0;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Data import' }]}
        title="Data import"
        description="Load people, organisations, teams and CIs from a CSV or Excel file. Preview first; nothing is written until you run it."
        actions={
          <Link to="/data-import/sync-sources" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
            <RefreshCw className="me-1.5 size-4" aria-hidden />
            Sync sources
          </Link>
        }
      />

      <Card className="mb-4">
        <CardHeader title="1. What to load" />
        <CardBody className="flex flex-wrap items-end gap-4">
          <label className="flex flex-col gap-1 text-[13px] text-ink">
            Records
            {classes.isLoading ? (
              <Skeleton className="h-9 w-56" />
            ) : (
              <Select
                aria-label="Records to load"
                className="w-56"
                value={className}
                onChange={(e) => chooseClass(e.target.value)}
                options={[
                  { value: '', label: 'Choose…' },
                  ...(classes.data?.classes ?? []).map((c) => ({ value: c.name, label: c.label })),
                ]}
              />
            )}
          </label>
          <label className="flex flex-col gap-1 text-[13px] text-ink">
            File (CSV or .xlsx)
            <input
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="File to import"
              disabled={!className}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void upload(file);
              }}
            />
          </label>
          {read.isPending ? <span className="text-[13px] text-ink-muted">Reading…</span> : null}
          {table ? (
            <p className="text-[13px] text-ink-secondary">
              {table.fileName}
              {table.sheet ? ` · sheet “${table.sheet}”` : ''} · {table.rows.length.toLocaleString()} rows ·{' '}
              {table.headings.length} columns
            </p>
          ) : null}
        </CardBody>
      </Card>
      <Problem error={classes.error ?? read.error} />

      {info && table ? (
        <MappingCard
          info={info}
          headings={table.headings}
          mapping={mapping}
          mustMap={false}
          onChange={mapColumn}
          onReset={() => {
            setEditedMapping(null);
            stale();
          }}
          options={LOOKUPS}
        />
      ) : null}

      {ready ? (
        <Card className="mb-4">
          <CardHeader
            title="Match existing records on"
            subtitle="A row whose values in these columns match a record updates it; otherwise it creates one. Tick none to create every row."
          />
          <CardBody>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {columns.map((column) => (
                <label key={column} className="flex items-center gap-2 text-[13px] text-ink">
                  <input type="checkbox" checked={keys.includes(column)} onChange={() => toggleKey(column)} />
                  <span className="font-mono text-[12px]">{column}</span>
                </label>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {ready ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            loading={preview.isPending}
            onClick={() => preview.mutate({ className, request: request() }, { onSuccess: setPlan })}
          >
            Preview
          </Button>
          <Button
            size="sm"
            leadingIcon={<Upload className="size-4" />}
            disabled={!plan || toWrite === 0 || Boolean(report)}
            loading={run.isPending}
            onClick={() => run.mutate({ className, request: request() }, { onSuccess: setReport })}
          >
            Run import
          </Button>
          <span className="text-[12px] text-ink-muted">
            {!plan
              ? 'Preview first.'
              : toWrite === 0
                ? 'Nothing to write.'
                : `${toWrite} record${toWrite === 1 ? '' : 's'} will be written` +
                  (plan.summary.error ? `; ${plan.summary.error} row${plan.summary.error === 1 ? '' : 's'} with errors will be skipped.` : '.')}
          </span>
        </div>
      ) : null}
      <Problem error={preview.error ?? run.error} />

      {report ? <ReportCard report={report} /> : plan ? <PlanCard plan={plan} /> : null}

      <RecentImports />
    </>
  );
}

function Summary({ items }: { items: [string, number, keyof typeof TONE][] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map(([label, count, tone]) => (
        <Badge key={label} tone={count ? TONE[tone] : 'neutral'} size="sm">
          {count} {label}
        </Badge>
      ))}
    </div>
  );
}

function PlanCard({ plan }: { plan: ImportPlan }) {
  const [only, setOnly] = useState<PlannedAction | ''>('');
  const rows = plan.rows.filter((r) => !only || r.action === only);
  const { summary } = plan;
  return (
    <Card className="mb-4">
      <CardHeader
        title="Preview — nothing written yet"
        action={
          <Select
            aria-label="Show rows"
            className="w-40"
            value={only}
            onChange={(e) => setOnly(e.target.value as PlannedAction | '')}
            options={[{ value: '', label: 'All rows' }, ...(['create', 'update', 'unchanged', 'error'] as const).map((a) => ({ value: a, label: ACTION_LABEL[a] }))]}
          />
        }
      />
      <CardBody>
        <Summary
          items={[
            ['to create', summary.create, 'create'],
            ['to update', summary.update, 'update'],
            ['unchanged', summary.unchanged, 'unchanged'],
            ['with errors', summary.error, 'error'],
          ]}
        />
        <RowTable
          className={plan.className}
          rows={rows.map((r) => ({ ...r, status: ACTION_LABEL[r.action], tone: TONE[r.action] }))}
        />
      </CardBody>
    </Card>
  );
}

function ReportCard({ report }: { report: ImportReport }) {
  const { summary } = report;
  return (
    <Card className="mb-4">
      <CardHeader
        title="Import finished"
        subtitle={`${report.fileName || 'File'} · ${new Date(report.finishedAt).toLocaleString()}`}
        action={<DownloadButton id={report.id} />}
      />
      <CardBody>
        <Summary
          items={[
            ['created', summary.created, 'created'],
            ['updated', summary.updated, 'updated'],
            ['unchanged', summary.unchanged, 'unchanged'],
            ['failed', summary.error, 'error'],
          ]}
        />
        <RowTable
          className={report.className}
          rows={report.rows.map((r) => ({ ...r, status: OUTCOME_LABEL[r.outcome], tone: TONE[r.outcome] }))}
        />
      </CardBody>
    </Card>
  );
}

interface ShownRow {
  line: number;
  status: string;
  tone: 'good' | 'info' | 'neutral' | 'critical';
  id?: number;
  key: string;
  changes: { field: string; from: string; to: string }[];
  errors: string[];
}

function RowTable({ className, rows }: { className: string; rows: ShownRow[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-start text-[13px]">
        <thead className="text-[12px] text-ink-muted">
          <tr>
            <th className="py-1 pe-3 font-medium">Line</th>
            <th className="py-1 pe-3 font-medium">Outcome</th>
            <th className="py-1 pe-3 font-medium">Record</th>
            <th className="py-1 pe-3 font-medium">Key</th>
            <th className="py-1 pe-3 font-medium">Changes / errors</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.slice(0, SHOWN).map((row) => (
            <tr key={row.line} className="align-top">
              <td className="py-1.5 pe-3 tabular-nums">{row.line}</td>
              <td className="py-1.5 pe-3">
                <Badge tone={row.tone} size="sm">
                  {row.status}
                </Badge>
              </td>
              <td className="py-1.5 pe-3">
                {row.id ? (
                  <Link to={`/records/${className}/${row.id}`} className="text-brand-ink hover:underline">
                    #{row.id}
                  </Link>
                ) : (
                  '—'
                )}
              </td>
              <td className="py-1.5 pe-3 text-ink-secondary">{row.key || '—'}</td>
              <td className="py-1.5 pe-3">
                {row.errors.length > 0 ? (
                  <ul className="text-critical-ink">
                    {row.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                ) : (
                  <ul className="text-ink-secondary">
                    {row.changes.map((c) => (
                      <li key={c.field}>
                        <span className="font-mono text-[12px]">{c.field}</span>:{' '}
                        {c.from ? <span className="line-through">{c.from}</span> : null} {c.to}
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > SHOWN ? (
        <p className="mt-2 text-[12px] text-ink-muted">
          Showing {SHOWN} of {rows.length.toLocaleString()} rows.
        </p>
      ) : null}
    </div>
  );
}

function DownloadButton({ id }: { id: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      leadingIcon={<Download className="size-4" />}
      onClick={async () => {
        setBusy(true);
        try {
          saveBlob(await downloadReport(id), `import-report-${id.slice(0, 8)}.csv`);
        } finally {
          setBusy(false);
        }
      }}
    >
      Report
    </Button>
  );
}

function RecentImports() {
  const reports = useImportReports();
  const list = reports.data?.reports ?? [];
  if (reports.isLoading || list.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Recent imports" subtitle="Each run's report, kept to download." />
      <CardBody>
        <ul className="divide-y divide-line" aria-label="Recent imports">
          {list.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="min-w-0 text-[13px]">
                <p className="font-medium text-ink">
                  {r.className} · {r.fileName || 'file'}
                </p>
                <p className="text-ink-muted">
                  {new Date(r.finishedAt).toLocaleString()} by {r.by || 'unknown'} · {r.summary.created} created ·{' '}
                  {r.summary.updated} updated · {r.summary.unchanged} unchanged · {r.summary.error} failed
                </p>
              </div>
              <DownloadButton id={r.id} />
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

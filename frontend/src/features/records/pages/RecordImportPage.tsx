import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';

import { PageHeader } from '@/components/layout';
import { Button, buttonClasses, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useClassInfo, useImport } from '../api/useRecords';
import { CONTROL } from '../components/FieldControls';
import {
  importTargets,
  isIdentityMapping,
  isImportColumn,
  mappedColumns,
  needsMapping,
  suggestMapping,
  type ImportMapping,
} from '../lib/import-mapping';
import type { ClassInfo, ImportReport } from '../types';

const SEPARATORS = [
  { value: ',', label: 'Comma (,)' },
  { value: ';', label: 'Semicolon (;)' },
  { value: '\t', label: 'Tab' },
];

/**
 * CSV import into any class, the way iTop's import wizard does it: load a
 * file, say which columns identify existing records, check it (a dry run
 * that writes nothing), then import. iTop's own bulk loader does the work,
 * so matching, validation and change tracking are iTop's.
 *
 * The header row names attribute codes. A related record can be given by id
 * (`org_id`) or matched by a field of its own (`org_id->name`).
 */
export function RecordImportPage() {
  const { className = '' } = useParams();
  const { data: info, isLoading } = useClassInfo(className);
  const run = useImport(className);

  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [separator, setSeparator] = useState(',');
  const [keys, setKeys] = useState<string[] | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  // The user's edits to the suggested mapping; null = the suggestion.
  const [editedMapping, setEditedMapping] = useState<ImportMapping | null>(null);
  const [showMapping, setShowMapping] = useState(false);

  const headings = useMemo(() => headerOf(csv, separator), [csv, separator]);
  const suggested = useMemo(() => (info ? suggestMapping(info, headings) : []), [info, headings]);
  const mapping = editedMapping ?? suggested;
  const mustMap = info ? needsMapping(info, headings) : false;
  const mapped = isIdentityMapping(headings, mapping) ? null : mapping;
  // What iTop will see: the headings once mapped.
  const columns = mapped ? mappedColumns(mapped) : headings;
  // Default to matching on `id` when the file has it, as an export does.
  const reconciliation = (keys ?? (columns.includes('id') ? ['id'] : [])).filter((k) => columns.includes(k));

  const send = (simulate: boolean) =>
    run.mutate(
      {
        csv,
        simulate,
        separator,
        ...(reconciliation.length ? { reconciliationKeys: reconciliation } : {}),
        ...(mapped ? { mapping: mapped } : {}),
      },
      { onSuccess: setReport },
    );

  const reset = (text: string, name: string) => {
    setCsv(text);
    setFileName(name);
    setKeys(null);
    setEditedMapping(null);
    setShowMapping(false);
    setReport(null);
    run.reset();
  };

  const mapColumn = (index: number, target: string | null) => {
    const next = [...mapping];
    // A field takes one column: moving it here frees it elsewhere.
    if (target !== null) {
      next.forEach((t, i) => {
        if (t === target) next[i] = null;
      });
    }
    next[index] = target;
    setEditedMapping(next);
    setReport(null);
  };

  const crumbs = [
    { label: 'Home', to: '/' },
    { label: 'Records', to: '/records' },
    { label: info?.labels?.class ?? className, to: `/records/${className}` },
    { label: 'Import' },
  ];

  if (isLoading || !info) {
    return (
      <>
        <PageHeader breadcrumbs={crumbs} title="Loading…" />
        <Skeleton className="h-96" />
      </>
    );
  }

  const checked = report?.simulated === true;

  return (
    <>
      <PageHeader
        breadcrumbs={crumbs}
        title={`Import ${info.labels.class}`}
        description="Load records from a CSV file. Check it first; nothing is written until you import."
        actions={
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Download className="size-4" />}
              onClick={() => downloadTemplate(info)}
            >
              Template
            </Button>
            <Link to={`/records/${className}`} className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
              <ArrowLeft className="mr-1.5 size-4" />
              All {info.labels.class}
            </Link>
          </div>
        }
      />

      <Card className="mb-4">
        <CardHeader title="File" />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="file"
              accept=".csv,text/csv,text/plain"
              aria-label="CSV file"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) reset(await file.text(), file.name);
              }}
            />
            <label className="flex items-center gap-2 text-[13px] text-ink">
              Separator
              <select
                className={cn(CONTROL, 'w-auto appearance-none')}
                value={separator}
                onChange={(e) => {
                  setSeparator(e.target.value);
                  setKeys(null);
                  setReport(null);
                }}
              >
                {SEPARATORS.map((s) => (
                  <option key={s.label} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <textarea
            rows={6}
            className={cn(CONTROL, 'font-mono text-[12px]')}
            placeholder={'Or paste CSV here — first line is the header, e.g.\nname,org_id,status'}
            value={csv}
            onChange={(e) => reset(e.target.value, '')}
          />
          {fileName ? <p className="text-[12px] text-ink-muted">{fileName}</p> : null}
        </CardBody>
      </Card>

      {headings.length > 0 && (mustMap || showMapping) ? (
        <MappingCard
          info={info}
          headings={headings}
          mapping={mapping}
          mustMap={mustMap}
          onChange={mapColumn}
          onReset={() => {
            setEditedMapping(null);
            setReport(null);
          }}
        />
      ) : headings.length > 0 ? (
        <p className="mb-4 text-[12px] text-ink-muted">
          Every heading names a field.{' '}
          <button type="button" className="text-brand-ink hover:underline" onClick={() => setShowMapping(true)}>
            Map columns…
          </button>
        </p>
      ) : null}

      {columns.length > 0 ? (
        <Card className="mb-4">
          <CardHeader
            title="Match existing records on"
            subtitle="Rows whose values in these columns match a record update it; the rest are created. Tick none to create every row."
          />
          <CardBody>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              {columns.map((column) => (
                <label key={column} className="flex items-center gap-2 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={reconciliation.includes(column)}
                    onChange={() => {
                      setReport(null);
                      setKeys(
                        reconciliation.includes(column)
                          ? reconciliation.filter((k) => k !== column)
                          : [...reconciliation, column],
                      );
                    }}
                  />
                  <span className="font-mono text-[12px]">{column}</span>
                  {isImportColumn(info, column) ? null : (
                    <span className="text-[11px] text-critical-ink">unknown column</span>
                  )}
                </label>
              ))}
            </div>
          </CardBody>
        </Card>
      ) : null}

      {csv.trim() ? (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => send(true)}
            disabled={columns.length === 0}
            loading={run.isPending && run.variables?.simulate}
          >
            Check file
          </Button>
          <Button
            size="sm"
            onClick={() => send(false)}
            disabled={!checked || report.summary.issues > 0}
            loading={run.isPending && run.variables?.simulate === false}
          >
            Import
          </Button>
          {columns.length === 0 ? (
            <span className="text-[12px] text-critical-ink">Map at least one column.</span>
          ) : !checked ? (
            <span className="text-[12px] text-ink-muted">Check the file first.</span>
          ) : report.summary.issues > 0 ? (
            <span className="text-[12px] text-critical-ink">Fix the lines with issues, then check again.</span>
          ) : null}
        </div>
      ) : null}

      {run.isError ? (
        <div
          role="alert"
          className="mb-4 rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink"
        >
          {run.error instanceof Error ? run.error.message : 'The import failed.'}
        </div>
      ) : null}

      {report ? <ImportReportView className={className} report={report} /> : null}
    </>
  );
}

const SKIP = '';

/**
 * Which field each of the file's columns loads into. Pre-filled from codes
 * and labels; a column can be skipped. iTop gets the file with these
 * headings, so its own checks and the dry run still apply.
 */
function MappingCard({
  info,
  headings,
  mapping,
  mustMap,
  onChange,
  onReset,
}: {
  info: ClassInfo;
  headings: string[];
  mapping: ImportMapping;
  mustMap: boolean;
  onChange: (index: number, target: string | null) => void;
  onReset: () => void;
}) {
  const targets = useMemo(() => importTargets(info), [info]);
  return (
    <Card className="mb-4">
      <CardHeader
        title="Map columns"
        subtitle={
          mustMap
            ? 'Some headings are not field names. Say which field each column fills, or skip it.'
            : 'Say which field each column fills, or skip it.'
        }
        action={
          <Button variant="ghost" size="sm" onClick={onReset}>
            Reset
          </Button>
        }
      />
      <CardBody>
        <table className="w-full text-left text-[13px]">
          <thead className="text-[12px] text-ink-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">Column in file</th>
              <th className="py-1 pr-3 font-medium">Field</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {headings.map((heading, index) => {
              const target = mapping[index] ?? null;
              // A heading such as `org_id->code` is valid but not in the list.
              const extra = target !== null && !targets.some((t) => t.value === target);
              return (
                <tr key={index}>
                  <td className="py-1.5 pr-3 font-mono text-[12px] text-ink">
                    {heading || <span className="text-ink-muted italic">(no heading)</span>}
                  </td>
                  <td className="py-1.5 pr-3">
                    <select
                      aria-label={`Field for column ${heading || index + 1}`}
                      className={cn(CONTROL, 'max-w-sm py-1.5', target === null && 'text-ink-muted')}
                      value={target ?? SKIP}
                      onChange={(e) => onChange(index, e.target.value === SKIP ? null : e.target.value)}
                    >
                      <option value={SKIP}>— Skip this column —</option>
                      {extra ? <option value={target}>{target}</option> : null}
                      {targets.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardBody>
    </Card>
  );
}

const KIND_STYLE:Record<ImportReport['rows'][number]['kind'], string> = {
  created: 'text-good-ink',
  updated: 'text-brand-ink',
  unchanged: 'text-ink-muted',
  error: 'text-critical-ink',
  other: 'text-ink',
};

function ImportReportView({ className, report }: { className: string; report: ImportReport }) {
  const { summary } = report;
  return (
    <Card>
      <CardHeader
        title={report.simulated ? 'Check result — nothing written yet' : 'Import result'}
        subtitle={[
          `${summary.created} ${report.simulated ? 'to create' : 'created'}`,
          `${summary.updated} ${report.simulated ? 'to update' : 'updated'}`,
          `${summary.unchanged} unchanged`,
          `${summary.issues} with issues`,
          `${summary.warnings} warnings`,
        ].join(' · ')}
      />
      <CardBody>
        {report.messages.length > 0 ? (
          <ul className="mb-3 space-y-0.5 text-[13px] text-ink-secondary">
            {report.messages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
        ) : null}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="text-[12px] text-ink-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">Line</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 font-medium">Record</th>
                {report.columns.map((c) => (
                  <th key={c} className="py-1 pr-3 font-medium">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.rows.map((row) => (
                <tr key={row.line}>
                  <td className="py-1 pr-3 tabular-nums">{row.line}</td>
                  <td className={cn('py-1 pr-3', KIND_STYLE[row.kind])}>{row.status}</td>
                  <td className="py-1 pr-3">
                    {/^\d+$/.test(row.id) ? (
                      <Link to={`/records/${row.class || className}/${row.id}`} className="text-brand-ink hover:underline">
                        #{row.id}
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                  {row.cells.map((cell, i) => (
                    <td key={i} className="py-1 pr-3 text-ink-secondary">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * The header row of a CSV, unquoted: the first non-blank record, read as
 * iTop reads it (a quoted heading may hold the separator). Every column is
 * kept, even an unnamed one, so positions line up with the file's columns
 * for the mapping.
 */
export function headerOf(csv: string, separator: string): string[] {
  const text = csv.replace(/^﻿/, '').replace(/^(?:[ \t]*\r?\n)+/, '');
  if (text.trim() === '') return [];
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) {
      cells.push(cell.trim());
      cell = '';
    } else if (ch === '\n' || ch === '\r') break;
    else cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

/** A header-only CSV of the class's importable columns, to fill in. */
function downloadTemplate(info: ClassInfo) {
  const columns = info.writable.filter(
    (a) => ['scalar', 'picker'].includes(info.fields[a]?.ui ?? '') && info.fields[a]?.type !== 'CaseLog',
  );
  const blob = new Blob([`${columns.join(',')}\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${info.name}-template.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

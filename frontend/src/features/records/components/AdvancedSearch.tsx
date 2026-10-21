import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { Button, Card, CardBody } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useOptionSearch } from '../api/useRecords';
import type { ClassInfo, Criterion, CriterionKind, CriterionOp } from '../types';
import { CONTROL, humaniseAttcode } from './FieldControls';

const OP_LABELS: Record<CriterionOp, string> = {
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  equals: 'is',
  not_equals: 'is not',
  in: 'is any of',
  not_in: 'is none of',
  gt: 'is after / above',
  gte: 'is on or after / at least',
  lt: 'is before / below',
  lte: 'is on or before / at most',
  between: 'is between',
  empty: 'is empty',
  not_empty: 'is not empty',
};

/** Operators that take no value. */
const NO_VALUE: ReadonlySet<CriterionOp> = new Set(['empty', 'not_empty']);

/** Is this criterion complete enough to send? */
export function isComplete(c: Criterion, kind: CriterionKind | undefined): boolean {
  if (NO_VALUE.has(c.op)) return true;
  if (kind === 'enum' || kind === 'key') return (c.values?.length ?? 0) > 0;
  if (c.op === 'between') return Boolean(c.value?.trim() && c.value2?.trim());
  return Boolean(c.value?.trim());
}

/**
 * Advanced search, iTop's criteria builder: add conditions on any searchable
 * field, each with the operators its kind supports, ANDed together. The
 * vocabulary is the BFF's, which turns it into OQL and checks every value.
 */
export function AdvancedSearch({
  info,
  value,
  onApply,
  onClose,
}: {
  info: ClassInfo;
  value: Criterion[];
  onApply: (criteria: Criterion[]) => void;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<Criterion[]>(value.length ? value : []);
  const complete = rows.filter((r) => isComplete(r, info.criteria?.[r.field]?.kind));

  return (
    <Card className="mb-4">
      <CardBody className="space-y-3">
        <ConditionRows
          info={info}
          value={rows}
          onChange={setRows}
          emptyText="No conditions yet. Add one to narrow the list."
        />
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="flex-1" />
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
          {value.length > 0 ? (
            <Button variant="secondary" size="sm" onClick={() => onApply([])}>
              Clear all
            </Button>
          ) : null}
          <Button size="sm" onClick={() => onApply(complete)} disabled={rows.length > 0 && complete.length === 0}>
            Apply
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * Editable condition rows: field, operator, value, ANDed together. Shared by
 * advanced search and notification rules ("only when…"), so both offer the
 * same operators and check values the same way. `exclude` hides fields that
 * make no sense for the caller (e.g. dates for a notification rule);
 * `valueLabels` names record ids already chosen, keyed "field:id".
 */
export function ConditionRows({
  info,
  value,
  onChange,
  exclude,
  valueLabels,
  emptyText,
}: {
  info: ClassInfo;
  value: Criterion[];
  onChange: (rows: Criterion[]) => void;
  exclude?: (code: string, kind: CriterionKind) => boolean;
  valueLabels?: Record<string, string>;
  emptyText?: string;
}) {
  const fields = useMemo(
    () =>
      Object.entries(info.criteria ?? {})
        .filter(([code, spec]) => !['id', 'friendlyname'].includes(code) && !exclude?.(code, spec.kind))
        .map(([code]) => code)
        .sort((a, b) => label(info, a).localeCompare(label(info, b))),
    [info, exclude],
  );
  const setRow = (index: number, patch: Partial<Criterion>) =>
    onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const add = () => {
    const field = fields[0];
    if (!field) return;
    onChange([...value, { field, op: info.criteria![field]!.ops[0]! }]);
  };

  return (
    <div className="space-y-3">
      {value.length === 0 && emptyText ? <p className="text-[13px] text-ink-muted">{emptyText}</p> : null}
      {value.map((row, index) => {
        const spec = info.criteria?.[row.field];
        return (
          <div key={index} className="flex flex-wrap items-start gap-2">
            <select
              aria-label="Field"
              className={cn(CONTROL, 'w-48 appearance-none')}
              value={row.field}
              onChange={(e) => {
                const field = e.target.value;
                setRow(index, { field, op: info.criteria![field]!.ops[0]!, value: undefined, value2: undefined, values: undefined });
              }}
            >
              {(fields.includes(row.field) ? fields : [row.field, ...fields]).map((code) => (
                <option key={code} value={code}>
                  {label(info, code)}
                </option>
              ))}
            </select>
            <select
              aria-label="Condition"
              className={cn(CONTROL, 'w-48 appearance-none')}
              value={row.op}
              onChange={(e) => setRow(index, { op: e.target.value as CriterionOp })}
            >
              {(spec?.ops ?? []).map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            {NO_VALUE.has(row.op) ? null : (
              <ValueInput
                info={info}
                row={row}
                kind={spec?.kind}
                valueLabels={valueLabels}
                onChange={(patch) => setRow(index, patch)}
              />
            )}
            <button
              type="button"
              aria-label="Remove condition"
              onClick={() => onChange(value.filter((_, i) => i !== index))}
              className="mt-1.5 rounded-control p-1 text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              <X className="size-4" />
            </button>
          </div>
        );
      })}
      <Button variant="secondary" size="sm" leadingIcon={<Plus className="size-4" />} onClick={add}>
        Add condition
      </Button>
    </div>
  );
}

function label(info: ClassInfo, code: string) {
  return info.labels?.fields?.[code] ?? humaniseAttcode(code);
}

function ValueInput({
  info,
  row,
  kind,
  valueLabels,
  onChange,
}: {
  info: ClassInfo;
  row: Criterion;
  kind: CriterionKind | undefined;
  valueLabels?: Record<string, string> | undefined;
  onChange: (patch: Partial<Criterion>) => void;
}) {
  if (kind === 'enum') {
    const values = info.fields[row.field]?.values ?? [];
    const selected = new Set(row.values ?? []);
    return (
      <div className="flex max-w-md flex-wrap gap-x-3 gap-y-1 pt-1.5">
        {values.map((v) => (
          <label key={v} className="flex items-center gap-1.5 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={selected.has(v)}
              onChange={() =>
                onChange({ values: selected.has(v) ? [...selected].filter((x) => x !== v) : [...selected, v] })
              }
            />
            {info.labels?.values?.[row.field]?.[v] ?? humaniseAttcode(v)}
          </label>
        ))}
      </div>
    );
  }

  if (kind === 'key') {
    return <KeyPicker info={info} row={row} valueLabels={valueLabels} onChange={onChange} />;
  }

  const type = kind === 'number' ? 'number' : kind === 'date' ? 'date' : 'text';
  return (
    <div className="flex items-center gap-2">
      <input
        aria-label="Value"
        type={type}
        className={cn(CONTROL, 'w-48')}
        value={row.value ?? ''}
        onChange={(e) => onChange({ value: e.target.value })}
      />
      {row.op === 'between' ? (
        <>
          <span className="text-[13px] text-ink-muted">and</span>
          <input
            aria-label="Second value"
            type={type}
            className={cn(CONTROL, 'w-48')}
            value={row.value2 ?? ''}
            onChange={(e) => onChange({ value2: e.target.value })}
          />
        </>
      ) : null}
    </div>
  );
}

/** Pick one or more related records by searching their names. */
function KeyPicker({
  info,
  row,
  valueLabels,
  onChange,
}: {
  info: ClassInfo;
  row: Criterion;
  valueLabels?: Record<string, string> | undefined;
  onChange: (patch: Partial<Criterion>) => void;
}) {
  const [q, setQ] = useState('');
  // Names for ids chosen before this screen opened come from the caller.
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(valueLabels ?? {})
        .filter(([key]) => key.startsWith(`${row.field}:`))
        .map(([key, name]) => [key.slice(row.field.length + 1), name]),
    ),
  );
  const { data } = useOptionSearch({ className: info.name, attcode: row.field }, q.trim());
  const selected = row.values ?? [];

  return (
    <div className="w-72">
      <div className="mb-1 flex flex-wrap gap-1">
        {selected.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-control bg-surface-hover px-2 py-0.5 text-[12px] text-ink"
          >
            {labels[id] ?? `#${id}`}
            <button
              type="button"
              aria-label="Remove"
              onClick={() => onChange({ values: selected.filter((v) => v !== id) })}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
      </div>
      <input
        aria-label="Search records"
        className={CONTROL}
        placeholder="Search…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {q.trim() ? (
        <ul className="mt-1 max-h-40 overflow-y-auto rounded-card border border-line">
          {(data?.options ?? [])
            .filter((o) => !selected.includes(String(o.id)))
            .map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="block w-full px-2 py-1 text-start text-[13px] text-ink hover:bg-surface-hover"
                  onClick={() => {
                    setLabels((l) => ({ ...l, [String(o.id)]: o.label }));
                    onChange({ values: [...selected, String(o.id)] });
                    setQ('');
                  }}
                >
                  {o.label}
                </button>
              </li>
            ))}
        </ul>
      ) : null}
    </div>
  );
}

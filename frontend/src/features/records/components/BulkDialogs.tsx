import { useMemo, useState } from 'react';
import { Button, Skeleton } from '@/components/ui';
import { useBulkDeletePlan } from '../api/useRecords';
import type { BulkResult, ClassInfo } from '../types';
import { FieldInput } from './FieldControls';
import { fieldLabel } from './RecordForm';
import { RecordDialog } from './TransitionDialog';

/**
 * Bulk modify: set the same values on every selected record, as iTop's
 * "Modify all…" does. Only the fields ticked are sent, so nothing else on
 * the records is touched.
 */
export function BulkEditDialog({
  info,
  count,
  pending,
  error,
  onApply,
  onClose,
}: {
  info: ClassInfo;
  count: number;
  pending: boolean;
  error?: string;
  onApply: (fields: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  // Writable plain values and pickers; the lifecycle state changes only
  // through actions, as in iTop.
  const editable = useMemo(
    () =>
      info.writable.filter(
        (a) =>
          a !== info.lifecycle?.attribute &&
          ['scalar', 'picker'].includes(info.fields[a]?.ui ?? '') &&
          info.fields[a]?.type !== 'CaseLog',
      ),
    [info],
  );
  const [chosen, setChosen] = useState<string[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});

  const toggle = (attcode: string) =>
    setChosen((c) => (c.includes(attcode) ? c.filter((a) => a !== attcode) : [...c, attcode]));

  return (
    <RecordDialog
      title={`Modify ${count} ${info.labels.class} record${count === 1 ? '' : 's'}`}
      onClose={onClose}
      onSubmit={() => onApply(Object.fromEntries(chosen.map((a) => [a, values[a] ?? ''])))}
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={pending} disabled={chosen.length === 0}>
            Apply to {count}
          </Button>
        </>
      }
    >
      {error ? <ErrorNote message={error} /> : null}
      <p className="text-[13px] text-ink-secondary">
        Tick the fields to change. The value is written to every selected record.
      </p>
      <ul className="max-h-[50vh] space-y-3 overflow-y-auto">
        {editable.map((attcode) => (
          <li key={attcode}>
            <label className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-ink">
              <input
                type="checkbox"
                checked={chosen.includes(attcode)}
                onChange={() => toggle(attcode)}
              />
              {fieldLabel(info, attcode)}
            </label>
            {chosen.includes(attcode) ? (
              <FieldInput
                className={info.name}
                attcode={attcode}
                spec={info.fields[attcode]!}
                value={values[attcode] ?? ''}
                onChange={(value) => setValues((v) => ({ ...v, [attcode]: value }))}
                valueLabels={info.labels.values?.[attcode]}
              />
            ) : null}
          </li>
        ))}
      </ul>
    </RecordDialog>
  );
}

/** Bulk delete: the combined plan first, then one confirm for all. */
export function BulkDeleteDialog({
  info,
  ids,
  pending,
  error,
  onConfirm,
  onClose,
}: {
  info: ClassInfo;
  ids: number[];
  pending: boolean;
  error?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const plan = useBulkDeletePlan(info.name, ids, true);
  const selected = new Set(ids);
  const others = (plan.data?.plan ?? []).filter((step) => !selected.has(step.id) || step.class !== info.name);
  const issues = (plan.data?.plan ?? []).filter((step) => !['deleted', 'deleted automatically to preserve integrity', 'external keys reset to preserve integrity'].includes(step.outcome));

  return (
    <RecordDialog
      title={`Delete ${ids.length} ${info.labels.class} record${ids.length === 1 ? '' : 's'}?`}
      onClose={onClose}
      onSubmit={onConfirm}
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            size="sm"
            loading={pending}
            disabled={plan.isLoading || plan.isError}
          >
            Delete {ids.length}
          </Button>
        </>
      }
    >
      {error || plan.error ? (
        <ErrorNote message={error ?? (plan.error as Error).message} />
      ) : null}
      {plan.isLoading ? (
        <Skeleton className="h-16" />
      ) : plan.data ? (
        <>
          <p className="text-[13px] text-ink-secondary">
            {others.length === 0
              ? 'Nothing else is affected. This cannot be undone.'
              : `This also changes ${others.length} other record${others.length === 1 ? '' : 's'}. This cannot be undone.`}
            {issues.length > 0
              ? ` iTop reports ${issues.length} problem${issues.length === 1 ? '' : 's'}; those records will fail and be listed afterwards.`
              : ''}
          </p>
          {others.length > 0 || issues.length > 0 ? (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-card border border-line px-3 py-2 text-[13px]">
              {[...issues, ...others.filter((o) => !issues.includes(o))].map((step) => (
                <li key={`${step.class}-${step.id}`} className="flex flex-col">
                  <span className="text-ink">
                    {step.class} #{step.id} — {step.outcome}
                  </span>
                  {step.detail ? <span className="text-[12px] text-ink-muted">{step.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </RecordDialog>
  );
}

/** What a bulk run did, record by record. */
export function BulkResultBanner({
  verb,
  result,
  onDismiss,
}: {
  verb: string;
  result: BulkResult;
  onDismiss: () => void;
}) {
  const failures = result.results.filter((r) => !r.ok);
  const tone =
    result.failed === 0
      ? 'border-good/30 bg-good-soft text-good-ink'
      : 'border-critical/30 bg-critical-soft text-critical-ink';

  return (
    <div role="status" className={`mb-4 rounded-card border px-4 py-3 text-[13px] ${tone}`}>
      <div className="flex items-center justify-between gap-4">
        <span>
          {result.succeeded} {verb}
          {result.failed > 0 ? `, ${result.failed} failed` : ''}.
        </span>
        <button type="button" onClick={onDismiss} className="underline">
          Dismiss
        </button>
      </div>
      {failures.length > 0 ? (
        <ul className="mt-2 space-y-0.5">
          {failures.map((f) => (
            <li key={f.id}>
              #{f.id}: {f.error}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink"
    >
      {message}
    </div>
  );
}

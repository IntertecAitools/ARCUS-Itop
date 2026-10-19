import { Button, Skeleton } from '@/components/ui';
import { useDeletePlan, useDeleteRecord } from '../api/useRecords';
import type { RecordDto } from '../types';
import { RecordDialog } from './TransitionDialog';

/**
 * Delete, the way iTop's console does it: preview first, then confirm.
 *
 * A delete in iTop can remove or update other records to keep the database
 * consistent. The BFF's `?simulate=true` returns that plan, and it is shown
 * here in full before the real delete is sent. When iTop says the delete
 * needs other changes made explicitly, the confirm button stays disabled.
 */
export function DeleteDialog({
  className,
  record,
  onDeleted,
  onClose,
}: {
  className: string;
  record: RecordDto;
  onDeleted: () => void;
  onClose: () => void;
}) {
  const id = String(record.id);
  const plan = useDeletePlan(className, id, true);
  const remove = useDeleteRecord(className, id);

  // Everything except the record itself is a side effect worth showing.
  const others = (plan.data?.plan ?? []).filter(
    (step) => !(step.class === record.class && step.id === record.id),
  );
  const blocked = plan.data ? !plan.data.ok : false;
  const error = (remove.error ?? plan.error) as Error | null;

  return (
    <RecordDialog
      title={`Delete ${record.label}?`}
      onClose={onClose}
      onSubmit={() => remove.mutate(undefined, { onSuccess: onDeleted })}
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="danger"
            size="sm"
            loading={remove.isPending}
            disabled={plan.isLoading || plan.isError || blocked}
          >
            Delete
          </Button>
        </>
      }
    >
      {error ? (
        <div
          role="alert"
          className="rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink"
        >
          {error.message}
        </div>
      ) : null}

      {plan.isLoading ? (
        <Skeleton className="h-16" />
      ) : plan.data ? (
        <>
          <p className="text-[13px] text-ink-secondary">
            {blocked
              ? 'This record cannot be deleted as it stands. iTop reports:'
              : others.length === 0
                ? 'Nothing else is affected. This cannot be undone.'
                : `Deleting it also changes ${others.length} other record${others.length === 1 ? '' : 's'}. This cannot be undone.`}
          </p>
          {others.length > 0 || blocked ? (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto rounded-card border border-line px-3 py-2 text-[13px]">
              {(blocked ? plan.data.plan : others).map((step) => (
                <li key={`${step.class}-${step.id}`} className="flex flex-col">
                  <span className="text-ink">
                    {step.class} #{step.id} — {step.outcome}
                  </span>
                  {step.detail ? (
                    <span className="text-[12px] text-ink-muted">{step.detail}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </RecordDialog>
  );
}

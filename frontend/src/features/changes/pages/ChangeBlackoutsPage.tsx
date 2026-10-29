import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/layout';
import { Button, Card, CardBody, CardHeader, IconButton, Input, Skeleton } from '@/components/ui';
import { dateTimeText, fromDateTimeInput, toDateTimeInput } from '@/lib/utils';
import { useBlackouts, useCreateBlackout, useDeleteBlackout, useUpdateBlackout } from '../api/useChanges';
import type { Blackout } from '../types';

const ALERT = 'rounded-card border px-3 py-2 text-[13px]';

interface Draft {
  id: string | null;
  name: string;
  start: string;
  end: string;
  reason: string;
}

const EMPTY: Draft = { id: null, name: '', start: '', end: '', reason: '' };

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * Blackout windows: periods closed to changes (a year-end freeze, a
 * migration weekend). Changes planned inside one are flagged on the change
 * calendar. Administrators only.
 */
export function ChangeBlackoutsPage() {
  const { data, isLoading, isError, error } = useBlackouts();
  const create = useCreateBlackout();
  const update = useUpdateBlackout();
  const remove = useDeleteBlackout();
  const [draft, setDraft] = useState<Draft>(EMPTY);

  const saving = create.isPending || update.isPending;
  const saveError = create.error ?? update.error;
  const valid = draft.name.trim() && draft.start && draft.end && draft.end > draft.start;

  const edit = (b: Blackout) =>
    setDraft({ id: b.id, name: b.name, start: toDateTimeInput(b.start), end: toDateTimeInput(b.end), reason: b.reason });

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: 'Home', to: '/' }, { label: 'Change blackout windows' }]}
        title="Change blackout windows"
        description="Periods closed to changes. Changes planned inside one are flagged on the change calendar."
      />

      {isError ? (
        <div role="alert" className={`${ALERT} mb-6 border-critical/30 bg-critical-soft text-critical-ink`}>
          Couldn’t load the blackout windows. {errorText(error, '')}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card>
          <CardHeader title="Windows" subtitle={data ? `${data.length} defined` : undefined} />
          <CardBody>
            {isLoading ? (
              <Skeleton className="h-40 w-full" />
            ) : !data?.length ? (
              <p className="text-[13px] text-ink-muted">No blackout window yet.</p>
            ) : (
              <ul className="divide-y divide-line" aria-label="Blackout windows">
                {data.map((b) => (
                  <li key={b.id} className="flex items-start gap-3 py-2.5 text-[13px]">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-ink">{b.name}</p>
                      <p className="text-ink-secondary">
                        {dateTimeText(b.start)} – {dateTimeText(b.end)}
                      </p>
                      {b.reason ? <p className="text-ink-muted">{b.reason}</p> : null}
                    </div>
                    <IconButton label={`Edit ${b.name}`} icon={<Pencil className="size-4" />} onClick={() => edit(b)} />
                    <IconButton
                      label={`Delete ${b.name}`}
                      icon={<Trash2 className="size-4" />}
                      onClick={() => {
                        if (window.confirm(`Delete the blackout window “${b.name}”?`)) remove.mutate(b.id);
                      }}
                    />
                  </li>
                ))}
              </ul>
            )}
            {remove.isError ? (
              <div role="alert" className={`${ALERT} mt-3 border-critical/30 bg-critical-soft text-critical-ink`}>
                {errorText(remove.error, 'The window could not be deleted.')}
              </div>
            ) : null}
          </CardBody>
        </Card>

        <Card className="h-fit">
          <CardHeader title={draft.id ? 'Edit window' : 'New window'} />
          <CardBody>
            <form
              className="space-y-3"
              aria-label={draft.id ? 'Edit blackout window' : 'New blackout window'}
              onSubmit={(e) => {
                e.preventDefault();
                if (!valid) return;
                const input = {
                  name: draft.name,
                  start: fromDateTimeInput(draft.start),
                  end: fromDateTimeInput(draft.end),
                  reason: draft.reason,
                };
                const done = { onSuccess: () => setDraft(EMPTY) };
                if (draft.id) update.mutate({ id: draft.id, input }, done);
                else create.mutate(input, done);
              }}
            >
              <div className="space-y-1.5">
                <label htmlFor="bo-name" className="block text-[13px] font-medium text-ink">Name</label>
                <Input id="bo-name" value={draft.name} placeholder="Year-end freeze" onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="bo-start" className="block text-[13px] font-medium text-ink">Starts</label>
                  <Input id="bo-start" type="datetime-local" value={draft.start} onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))} />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="bo-end" className="block text-[13px] font-medium text-ink">Ends</label>
                  <Input id="bo-end" type="datetime-local" value={draft.end} onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="bo-reason" className="block text-[13px] font-medium text-ink">Reason</label>
                <Input id="bo-reason" value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))} />
              </div>
              {draft.start && draft.end && draft.end <= draft.start ? (
                <p className="text-[12px] text-critical-ink">The window must end after it starts.</p>
              ) : null}
              {saveError ? (
                <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
                  {errorText(saveError, 'The window could not be saved.')}
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                {draft.id ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => setDraft(EMPTY)}>
                    Cancel
                  </Button>
                ) : null}
                <Button type="submit" size="sm" disabled={!valid} loading={saving}>
                  {draft.id ? 'Save window' : 'Add window'}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardHeader, IconButton, Input, Skeleton, type BadgeTone } from '@/components/ui';
import { dateTimeText } from '@/lib/utils';
import { useChangePir, useSavePir } from '../api/useChanges';
import type { ChangePir, PirFollowUp, PirOutcome } from '../types';

const CONTROL =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';
const ALERT = 'rounded-card border px-3 py-2 text-[13px]';

export const OUTCOME_LABEL: Record<PirOutcome, string> = {
  successful: 'Successful',
  partial: 'Partially successful',
  failed: 'Failed',
  rolled_back: 'Rolled back',
};

export const OUTCOME_TONE: Record<PirOutcome, BadgeTone> = {
  successful: 'good',
  partial: 'warning',
  failed: 'critical',
  rolled_back: 'serious',
};

const OUTCOMES = Object.keys(OUTCOME_LABEL) as PirOutcome[];

const BLANK_FOLLOW_UP: PirFollowUp = { text: '', owner: '', due: '', done: false };

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

interface Draft {
  outcome: PirOutcome | '';
  wentWell: string;
  wentBadly: string;
  incidents: string;
  followUps: PirFollowUp[];
}

function draftOf(pir: ChangePir): Draft {
  const r = pir.review;
  return {
    outcome: r?.outcome ?? '',
    wentWell: r?.wentWell ?? '',
    wentBadly: r?.wentBadly ?? '',
    incidents: r?.incidents.map((i) => i.ref).join(', ') ?? '',
    followUps: r?.followUps.length ? r.followUps.map((f) => ({ ...f })) : [{ ...BLANK_FOLLOW_UP }],
  };
}

/**
 * The post-implementation review: once the change is in, how it went, what
 * went well and badly, the incidents it caused and the follow-up actions.
 * Until one is written, the change is in the "PIR due" queue.
 */
export function PirCard({ id }: { id: string }) {
  const pir = useChangePir(id);
  const save = useSavePir(id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (pir.data) setDraft(draftOf(pir.data));
  }, [pir.data]);

  if (pir.isLoading || (pir.data && !draft)) return <Skeleton className="h-48 w-full" />;
  if (pir.isError || !pir.data || !draft) {
    return (
      <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
        {errorText(pir.error, 'The review could not be loaded.')}
      </div>
    );
  }

  const data = pir.data;
  if (!data.allowed) {
    return (
      <Card>
        <CardHeader title="Post-implementation review" />
        <CardBody>
          <p className="text-[13px] text-ink-muted">Written once the change is implemented.</p>
        </CardBody>
      </Card>
    );
  }

  const review = data.review;
  if (review && !editing) {
    return (
      <Card>
        <CardHeader
          title="Post-implementation review"
          subtitle={`By ${review.completedBy || 'someone'} on ${dateTimeText(review.completedAt)}`}
          action={
            <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
              Edit
            </Button>
          }
        />
        <CardBody className="space-y-3 text-[13px]">
          <Badge tone={OUTCOME_TONE[review.outcome]} dot>
            {OUTCOME_LABEL[review.outcome]}
          </Badge>
          {review.wentWell ? <Section title="What went well">{review.wentWell}</Section> : null}
          {review.wentBadly ? <Section title="What didn’t">{review.wentBadly}</Section> : null}
          <Section title="Incidents caused">
            {review.incidents.length ? review.incidents.map((i) => `${i.ref} ${i.title}`).join('\n') : 'None'}
          </Section>
          {review.followUps.length ? (
            <div>
              <h3 className="mb-1 font-medium text-ink">Follow-up actions</h3>
              <ul className="space-y-1">
                {review.followUps.map((f, i) => (
                  <li key={i} className={f.done ? 'text-ink-muted line-through' : 'text-ink'}>
                    {f.text}
                    {f.owner ? ` · ${f.owner}` : ''}
                    {f.due ? ` · due ${f.due}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      </Card>
    );
  }

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setFollowUp = (index: number, patch: Partial<PirFollowUp>) =>
    set({ followUps: draft.followUps.map((f, i) => (i === index ? { ...f, ...patch } : f)) });
  const needsBadly = draft.outcome !== '' && draft.outcome !== 'successful' && !draft.wentBadly.trim();

  return (
    <Card>
      <CardHeader
        title="Post-implementation review"
        subtitle={data.due ? 'Due: how did the change go?' : 'Editing the review'}
      />
      <CardBody>
        <form
          className="space-y-4"
          aria-label="Post-implementation review"
          onSubmit={(e) => {
            e.preventDefault();
            if (!draft.outcome) return;
            save.mutate(
              {
                outcome: draft.outcome,
                wentWell: draft.wentWell,
                wentBadly: draft.wentBadly,
                incidents: draft.incidents.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean),
                followUps: draft.followUps.filter((f) => f.text.trim()),
              },
              { onSuccess: () => setEditing(false) },
            );
          }}
        >
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-[13px] font-medium text-ink">Outcome</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
              {OUTCOMES.map((o) => (
                <label key={o} className="flex items-center gap-1.5 text-[13px] text-ink">
                  <input type="radio" name="pir-outcome" checked={draft.outcome === o} onChange={() => set({ outcome: o })} />
                  {OUTCOME_LABEL[o]}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="pir-well" className="block text-[13px] font-medium text-ink">
                What went well
              </label>
              <textarea id="pir-well" rows={3} className={CONTROL} value={draft.wentWell} onChange={(e) => set({ wentWell: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="pir-badly" className="block text-[13px] font-medium text-ink">
                What didn’t{draft.outcome && draft.outcome !== 'successful' ? ' (required)' : ''}
              </label>
              <textarea id="pir-badly" rows={3} className={CONTROL} value={draft.wentBadly} onChange={(e) => set({ wentBadly: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="pir-incidents" className="block text-[13px] font-medium text-ink">
              Incidents caused
            </label>
            <Input
              id="pir-incidents"
              placeholder="Incident numbers, e.g. I-000123, I-000124"
              value={draft.incidents}
              onChange={(e) => set({ incidents: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <h3 className="text-[13px] font-medium text-ink">Follow-up actions</h3>
            {draft.followUps.map((f, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  type="checkbox"
                  aria-label="Done"
                  checked={f.done}
                  onChange={(e) => setFollowUp(i, { done: e.target.checked })}
                />
                <Input
                  aria-label="Action"
                  className="min-w-48 flex-1"
                  placeholder="What needs doing"
                  value={f.text}
                  onChange={(e) => setFollowUp(i, { text: e.target.value })}
                />
                <Input aria-label="Owner" className="w-40" placeholder="Owner" value={f.owner} onChange={(e) => setFollowUp(i, { owner: e.target.value })} />
                <Input aria-label="Due" type="date" className="w-40" value={f.due} onChange={(e) => setFollowUp(i, { due: e.target.value })} />
                <IconButton
                  type="button"
                  label="Remove action"
                  icon={<Trash2 className="size-4" />}
                  onClick={() => set({ followUps: draft.followUps.filter((_, j) => j !== i) })}
                />
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              leadingIcon={<Plus className="size-4" />}
              onClick={() => set({ followUps: [...draft.followUps, { ...BLANK_FOLLOW_UP }] })}
            >
              Add action
            </Button>
          </div>

          {save.isError ? (
            <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
              {errorText(save.error, 'The review could not be saved.')}
            </div>
          ) : null}

          <div className="flex justify-end gap-2">
            {review ? (
              <Button type="button" size="sm" variant="secondary" onClick={() => { setDraft(draftOf(data)); setEditing(false); }}>
                Cancel
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!draft.outcome || needsBadly} loading={save.isPending}>
              Save review
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: string }) {
  return (
    <div>
      <h3 className="mb-1 font-medium text-ink">{title}</h3>
      <p className="whitespace-pre-line text-ink-secondary">{children}</p>
    </div>
  );
}

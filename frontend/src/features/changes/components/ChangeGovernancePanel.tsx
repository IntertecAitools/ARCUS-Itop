import { useEffect, useState } from 'react';
import { Badge, Button, Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { dateTimeText, fromDateTimeInput, toDateTimeInput } from '@/lib/utils';
import { useChangeGovernance, useRecordCabDecision, useSavePlans } from '../api/useChanges';
import {
  DECISION_LABEL,
  DECISION_TONE,
  PLAN_HINT,
  PLAN_KINDS,
  PLAN_LABEL,
  REQUIREMENT_LABEL,
  TYPE_LABEL,
} from '../lib/labels';
import type { CabDecisionValue, ChangeGovernance, ChangePlans, PlanKind } from '../types';
import { PirCard } from './PirCard';
import { RiskCard } from './RiskCard';

const CONTROL =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';

const ALERT = 'rounded-card border px-3 py-2 text-[13px]';

const EMPTY: ChangePlans = { implementation: '', rollback: '', test: '' };

const sameAs = (a: ChangePlans, b: ChangePlans) => PLAN_KINDS.every((k) => a[k].trim() === b[k].trim());

/** Plans only the arcus-change-cab extension provides. */
const EXTENSION_PLANS: PlanKind[] = ['implementation', 'test'];

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/**
 * A change's plans and its Change Advisory Board decisions, a tab of the
 * change's record screen.
 *
 * Which plans are required, and when, comes from the change type's rule
 * (Change plan rules, under administration); Plan and Implement are refused
 * until they are written. A normal or emergency change is approved or not
 * approved here, by recording the CAB's decision. The risk questionnaire
 * sits beside them, and the post-implementation review once the change is in.
 */
export function ChangeGovernancePanel({ id }: { id: string }) {
  const governance = useChangeGovernance(id);

  if (governance.isLoading) return <Skeleton className="h-80 w-full" />;
  if (governance.isError || !governance.data) {
    return (
      <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
        {errorText(governance.error, 'The change plans could not be loaded.')}
      </div>
    );
  }

  const data = governance.data;
  return (
    <div className="space-y-4">
      {!data.available ? (
        <div role="status" className={`${ALERT} border-warning/30 bg-warning-soft text-ink`}>
          This iTop has no implementation or test plans and no CAB decisions on changes yet. An
          administrator installs the arcus-change-cab extension to turn them on; the rollback plan
          works without it.
        </div>
      ) : null}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <PlansCard id={id} data={data} />
        <CabCard id={id} data={data} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <RiskCard id={id} />
        <PirCard id={id} />
      </div>
    </div>
  );
}

function PlansCard({ id, data }: { id: string; data: ChangeGovernance }) {
  const save = useSavePlans(id);
  const [draft, setDraft] = useState<ChangePlans>(EMPTY);

  // Load the saved version into the form, and again after every save.
  useEffect(() => setDraft({ ...data.plans }), [data.plans]);

  const dirty = !sameAs(draft, data.plans);
  const missingNow = data.status === 'approved' || data.status === 'planned' ? data.missing.implement : data.missing.plan;

  return (
    <Card>
      <CardHeader
        title="Plans"
        subtitle={`What a ${TYPE_LABEL[data.type].toLowerCase()} change needs is set in Change plan rules.`}
      />
      <CardBody>
        {missingNow.length > 0 ? (
          <div role="status" className={`${ALERT} mb-4 border-warning/30 bg-warning-soft text-ink`}>
            Still missing: {missingNow.map((k) => PLAN_LABEL[k].toLowerCase()).join(', ')}.
          </div>
        ) : null}
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const changed: Partial<ChangePlans> = {};
            for (const k of PLAN_KINDS) if (draft[k].trim() !== data.plans[k].trim()) changed[k] = draft[k];
            save.mutate(changed);
          }}
        >
          {PLAN_KINDS.map((kind) => {
            const disabled = !data.available && EXTENSION_PLANS.includes(kind);
            const requirement = data.requirements[kind];
            return (
              <div key={kind} className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor={`plan-${kind}`} className="block text-[13px] font-medium text-ink">
                    {PLAN_LABEL[kind]}
                  </label>
                  <Badge size="sm" tone={requirement === 'optional' ? 'neutral' : 'brand'}>
                    {REQUIREMENT_LABEL[requirement]}
                  </Badge>
                </div>
                <textarea
                  id={`plan-${kind}`}
                  rows={kind === 'implementation' ? 5 : 3}
                  className={CONTROL}
                  placeholder={PLAN_HINT[kind]}
                  value={draft[kind]}
                  disabled={disabled}
                  onChange={(e) => setDraft((d) => ({ ...d, [kind]: e.target.value }))}
                />
              </div>
            );
          })}

          {save.isError ? (
            <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
              {errorText(save.error, 'The plans could not be saved.')}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            {dirty ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setDraft({ ...data.plans })}>
                Discard changes
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={!dirty} loading={save.isPending}>
              Save plans
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

const DECISIONS: Array<{ value: CabDecisionValue; label: string; hint: string }> = [
  { value: 'approved', label: 'Approve', hint: 'The change is approved and can be implemented.' },
  { value: 'rejected', label: 'Not approve', hint: 'The change goes back to its planner to re-plan.' },
  { value: 'deferred', label: 'Defer', hint: 'Recorded; the change waits for the next meeting.' },
];

function nowInput() {
  return toDateTimeInput(new Date().toISOString());
}

function CabCard({ id, data }: { id: string; data: ChangeGovernance }) {
  const record = useRecordCabDecision(id);
  const [meeting, setMeeting] = useState(nowInput);
  const [attendees, setAttendees] = useState('');
  const [decision, setDecision] = useState<CabDecisionValue | ''>('');
  const [conditions, setConditions] = useState('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState<CabDecisionValue | null>(null);

  const reset = () => {
    setMeeting(nowInput());
    setAttendees('');
    setDecision('');
    setConditions('');
    setNotes('');
  };

  if (!data.cab.required) {
    return (
      <Card className="h-fit">
        <CardHeader title="Change Advisory Board" />
        <CardBody>
          <p className="text-[13px] text-ink-muted">
            Routine changes are pre-approved: they do not go to the CAB.
          </p>
        </CardBody>
      </Card>
    );
  }

  const needsNotes = decision === 'rejected' && !notes.trim();
  const status = data.cab.awaiting
    ? 'Awaiting the CAB'
    : data.status === 'approved' || data.status === 'implemented' || data.status === 'monitored' || data.status === 'closed'
      ? 'Approved'
      : data.status === 'not_approved'
        ? 'Not approved: re-plan to bring it back'
        : 'Goes to the CAB once it is planned';

  return (
    <Card className="h-fit">
      <CardHeader title="Change Advisory Board" subtitle={status} />
      <CardBody className="space-y-4">
        {done ? (
          <div role="status" className={`${ALERT} border-good/30 bg-good-soft text-good-ink`}>
            Decision recorded: {DECISION_LABEL[done].toLowerCase()}.
          </div>
        ) : null}

        {data.cab.canDecide ? (
          <form
            className="space-y-3"
            aria-label="Record the CAB decision"
            onSubmit={(e) => {
              e.preventDefault();
              if (!decision) return;
              record.mutate(
                {
                  meetingDate: fromDateTimeInput(meeting),
                  attendees: attendees.split('\n').map((a) => a.trim()).filter(Boolean),
                  decision,
                  conditions,
                  notes,
                },
                {
                  onSuccess: () => {
                    setDone(decision);
                    reset();
                  },
                },
              );
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor="cab-meeting" className="block text-[13px] font-medium text-ink">
                Meeting date
              </label>
              <input
                id="cab-meeting"
                type="datetime-local"
                className={CONTROL}
                value={meeting}
                required
                onChange={(e) => setMeeting(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cab-attendees" className="block text-[13px] font-medium text-ink">
                Attendees
              </label>
              <textarea
                id="cab-attendees"
                rows={3}
                className={CONTROL}
                placeholder="One per line"
                value={attendees}
                onChange={(e) => setAttendees(e.target.value)}
              />
            </div>
            <fieldset className="space-y-1.5">
              <legend className="mb-1.5 text-[13px] font-medium text-ink">Decision</legend>
              {DECISIONS.map((d) => (
                <label key={d.value} className="flex items-start gap-2 text-[13px] text-ink">
                  <input
                    type="radio"
                    name="cab-decision"
                    className="mt-0.5"
                    value={d.value}
                    checked={decision === d.value}
                    onChange={() => setDecision(d.value)}
                  />
                  <span>
                    <span className="font-medium">{d.label}</span>{' '}
                    <span className="text-ink-muted">{d.hint}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <div className="space-y-1.5">
              <label htmlFor="cab-conditions" className="block text-[13px] font-medium text-ink">
                Conditions
              </label>
              <textarea
                id="cab-conditions"
                rows={2}
                className={CONTROL}
                placeholder="E.g. only outside business hours"
                value={conditions}
                onChange={(e) => setConditions(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="cab-notes" className="block text-[13px] font-medium text-ink">
                Notes{decision === 'rejected' ? ' (why it was not approved)' : ''}
              </label>
              <textarea
                id="cab-notes"
                rows={3}
                className={CONTROL}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>

            {record.isError ? (
              <div role="alert" className={`${ALERT} border-critical/30 bg-critical-soft text-critical-ink`}>
                {errorText(record.error, 'The decision could not be recorded.')}
              </div>
            ) : null}

            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={!decision || needsNotes} loading={record.isPending}>
                Record decision
              </Button>
            </div>
          </form>
        ) : data.cab.awaiting && data.available ? (
          <p className="text-[13px] text-ink-muted">A Change Approver records the CAB’s decision here.</p>
        ) : null}

        <div>
          <h3 className="mb-2 text-[13px] font-medium text-ink">Decisions</h3>
          {data.cab.decisions.length === 0 ? (
            <p className="text-[13px] text-ink-muted">None recorded yet.</p>
          ) : (
            <ol className="space-y-3" aria-label="CAB decisions">
              {data.cab.decisions.map((d) => (
                <li key={d.id} className="rounded-card border border-line px-3 py-2 text-[13px]">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge size="sm" dot tone={DECISION_TONE[d.decision]}>
                      {DECISION_LABEL[d.decision]}
                    </Badge>
                    <span className="text-ink-muted">{dateTimeText(d.meetingDate)}</span>
                  </div>
                  {d.attendees.length ? (
                    <p className="mt-1.5 text-ink">
                      <span className="text-ink-muted">Attendees: </span>
                      {d.attendees.join(', ')}
                    </p>
                  ) : null}
                  {d.conditions ? (
                    <p className="mt-1 whitespace-pre-line text-ink">
                      <span className="text-ink-muted">Conditions: </span>
                      {d.conditions}
                    </p>
                  ) : null}
                  {d.notes ? <p className="mt-1 whitespace-pre-line text-ink">{d.notes}</p> : null}
                  {d.recordedBy ? (
                    <p className="mt-1 text-[12px] text-ink-muted">Recorded by {d.recordedBy}</p>
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

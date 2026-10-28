import { useState } from 'react';
import { Check, CircleSlash, PauseCircle, RotateCcw, UserPlus } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { useIncidentOptions, useTransitionIncident } from '../api/useIncidents';
import type { IncidentDetail, TransitionAction } from '../types';

/** Icon + wording per action. Order here is the order they appear. */
const ACTION_META: Record<
  TransitionAction,
  { label: string; icon: typeof Check; variant: 'primary' | 'secondary' }
> = {
  assign: { label: 'Assign', icon: UserPlus, variant: 'primary' },
  reassign: { label: 'Reassign', icon: UserPlus, variant: 'secondary' },
  hold: { label: 'Put on hold', icon: PauseCircle, variant: 'secondary' },
  resolve: { label: 'Resolve', icon: Check, variant: 'primary' },
  close: { label: 'Close', icon: CircleSlash, variant: 'primary' },
  reopen: { label: 'Reopen', icon: RotateCcw, variant: 'secondary' },
};

const ORDER: TransitionAction[] = ['assign', 'reassign', 'resolve', 'hold', 'close', 'reopen'];

/** Today as `YYYY-MM-DD` on this computer's calendar: the earliest next-action date. */
export function todayInput(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * The lifecycle buttons.
 *
 * Rendered from `availableActions`, which the backend derives from iTop's own
 * lifecycle — so the UI can never offer a transition iTop would reject, and a
 * datamodel change flows through without a frontend edit.
 */
export function IncidentActions({ incident }: { incident: IncidentDetail }) {
  const transition = useTransitionIncident(incident.id);
  const { data: options } = useIncidentOptions();
  const [pending, setPending] = useState<TransitionAction | null>(null);
  const [agentId, setAgentId] = useState('');
  const [solution, setSolution] = useState('');
  const [resolutionCode, setResolutionCode] = useState('');
  const [pendingReason, setPendingReason] = useState('');
  const [nextActionDate, setNextActionDate] = useState('');

  const actions = ORDER.filter((action) => incident.availableActions.includes(action));

  if (actions.length === 0) {
    // Nothing offered on an open incident means the caller's iTop profiles
    // grant no action at this stage (a Service Desk Agent may assign and
    // close, but holding and resolving belong to support agents).
    return (
      <p className="text-[13px] text-ink-muted">
        {incident.status === 'closed'
          ? 'This incident is closed. No further actions are available.'
          : 'Your role has no actions on this incident at this stage. A support agent can put it on hold, resolve or reassign it.'}
      </p>
    );
  }

  const needsAgent = pending === 'assign' || pending === 'reassign';
  const needsSolution = pending === 'resolve';
  // On hold needs both: why it waits, and the day someone acts on it again.
  const needsHold = pending === 'hold';
  const today = todayInput();
  const canSubmit = needsAgent
    ? Boolean(agentId)
    : needsSolution
      ? Boolean(solution.trim())
      : needsHold
        ? Boolean(pendingReason.trim()) && nextActionDate >= today
        : true;

  const reset = () => {
    setPending(null);
    setAgentId('');
    setSolution('');
    setResolutionCode('');
    setPendingReason('');
    setNextActionDate('');
  };

  const submit = () => {
    if (!pending || !canSubmit) return;
    transition.mutate(
      {
        action: pending,
        ...(needsAgent ? { agentId } : {}),
        ...(needsSolution ? { solution, ...(resolutionCode ? { resolutionCode } : {}) } : {}),
        ...(needsHold ? { pendingReason: pendingReason.trim(), nextActionDate } : {}),
      },
      { onSuccess: reset },
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const meta = ACTION_META[action];
          const Icon = meta.icon;
          return (
            <Button
              key={action}
              size="sm"
              variant={pending === action ? 'primary' : meta.variant}
              leadingIcon={<Icon className="size-4" />}
              onClick={() => (pending === action ? reset() : setPending(action))}
            >
              {meta.label}
            </Button>
          );
        })}
      </div>

      {pending ? (
        <div className="space-y-2.5 rounded-control border border-line bg-surface-sunken p-3">
          {needsAgent ? (
            <Select
              aria-label="Agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              options={[
                { value: '', label: 'Select an agent…' },
                ...(options?.agents ?? []),
              ]}
            />
          ) : null}

          {needsSolution ? (
            <>
              <textarea
                value={solution}
                onChange={(e) => setSolution(e.target.value)}
                rows={3}
                placeholder="What fixed it? This becomes the resolution."
                aria-label="Resolution"
                className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40"
              />
              <Select
                aria-label="Resolution code"
                value={resolutionCode}
                onChange={(e) => setResolutionCode(e.target.value)}
                options={[
                  { value: '', label: 'Resolution code (optional)' },
                  ...(options?.resolutionCodes ?? []),
                ]}
              />
            </>
          ) : null}

          {needsHold ? (
            <>
              <textarea
                value={pendingReason}
                onChange={(e) => setPendingReason(e.target.value)}
                rows={2}
                placeholder="Why is it on hold? E.g. waiting for the caller's logs."
                aria-label="Pending reason"
                className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40"
              />
              <label className="block text-[12.5px] text-ink-secondary">
                Next action date
                <Input
                  type="date"
                  aria-label="Next action date"
                  className="mt-1"
                  min={today}
                  value={nextActionDate}
                  onChange={(e) => setNextActionDate(e.target.value)}
                />
              </label>
              {incident.extrasAvailable === false ? (
                <p className="text-[12.5px] text-warning-ink">
                  This platform cannot record a next-action date yet, so the hold will be refused.
                </p>
              ) : null}
            </>
          ) : null}

          {transition.isError ? (
            <p role="alert" className="text-[13px] text-critical-ink">
              {transition.error instanceof Error ? transition.error.message : 'That action failed.'}
            </p>
          ) : null}

          <div className="flex items-center gap-2">
            <Button size="sm" onClick={submit} disabled={!canSubmit} loading={transition.isPending}>
              Confirm {ACTION_META[pending].label.toLowerCase()}
            </Button>
            <Button size="sm" variant="ghost" onClick={reset}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

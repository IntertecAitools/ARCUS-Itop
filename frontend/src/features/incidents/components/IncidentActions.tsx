import { useState } from 'react';
import { Check, CircleSlash, PauseCircle, RotateCcw, UserPlus } from 'lucide-react';
import { Button, Select } from '@/components/ui';
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

  const actions = ORDER.filter((action) => incident.availableActions.includes(action));

  if (actions.length === 0) {
    return (
      <p className="text-[13px] text-ink-muted">
        This incident is closed. No further actions are available.
      </p>
    );
  }

  const needsAgent = pending === 'assign' || pending === 'reassign';
  const needsSolution = pending === 'resolve';
  const canSubmit = needsAgent ? Boolean(agentId) : needsSolution ? Boolean(solution.trim()) : true;

  const reset = () => {
    setPending(null);
    setAgentId('');
    setSolution('');
    setResolutionCode('');
  };

  const submit = () => {
    if (!pending || !canSubmit) return;
    transition.mutate(
      {
        action: pending,
        ...(needsAgent ? { agentId } : {}),
        ...(needsSolution ? { solution, ...(resolutionCode ? { resolutionCode } : {}) } : {}),
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

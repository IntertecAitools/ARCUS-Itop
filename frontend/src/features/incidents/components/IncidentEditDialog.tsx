import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useIncidentOptions, useUpdateIncident } from '../api/useIncidents';
import type { IncidentDetail, UpdateIncidentInput } from '../types';

const FIELD =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';

/** iTop's numeric enums come back decoded; map them back for the <select>. */
const URGENCY_VALUE: Record<string, string> = {
  critical: '1',
  high: '2',
  medium: '3',
  low: '4',
};
const IMPACT_VALUE: Record<string, string> = {
  critical: '1',
  high: '2',
  medium: '3',
  department: '1',
  service: '2',
  person: '3',
  '1': '1',
  '2': '2',
  '3': '3',
};

interface Props {
  incident: IncidentDetail;
  onClose: () => void;
}

/**
 * Edits the fields iTop lets us write.
 *
 * Priority is absent on purpose: iTop derives it from urgency × impact and
 * discards anything sent directly, so offering it would be a control that
 * silently does nothing. Changing urgency or impact moves priority instead.
 */
export function IncidentEditDialog({ incident, onClose }: Props) {
  const { data: options } = useIncidentOptions();
  const update = useUpdateIncident(incident.id);

  const [form, setForm] = useState({
    title: incident.summary,
    description: incident.description.replace(/<[^>]+>/g, '').trim(),
    urgency: URGENCY_VALUE[incident.urgency ?? ''] ?? '3',
    impact: IMPACT_VALUE[incident.impact ?? ''] ?? '2',
    agentId: incident.assignee?.id ?? '',
    teamId: incident.team?.id ?? '',
  });

  // Escape closes, like every other dismissible surface in the app.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const set = (key: keyof typeof form) => (value: string) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();

    // Send only what actually changed. A full payload would rewrite fields the
    // user never touched and bury the real edit in iTop's change history.
    const patch: UpdateIncidentInput = {};
    if (form.title !== incident.summary) patch.title = form.title;
    if (form.description !== incident.description.replace(/<[^>]+>/g, '').trim()) {
      patch.description = form.description;
    }
    if (form.urgency !== (URGENCY_VALUE[incident.urgency ?? ''] ?? '3')) {
      patch.urgency = form.urgency;
    }
    if (form.impact !== (IMPACT_VALUE[incident.impact ?? ''] ?? '2')) patch.impact = form.impact;
    if (form.agentId !== (incident.assignee?.id ?? '')) patch.agentId = form.agentId || null;
    if (form.teamId !== (incident.team?.id ?? '')) patch.teamId = form.teamId || null;

    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }

    update.mutate(patch, { onSuccess: onClose });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[color:var(--arcus-ink)]/25 px-4 py-10 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${incident.ref}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-2xl rounded-panel border border-line bg-surface-raised shadow-overlay"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-ink">Edit {incident.ref}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-control p-1 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="space-y-4 px-5 py-4">
          <div>
            <label htmlFor="edit-title" className="mb-1.5 block text-[13px] font-medium text-ink">
              Title
            </label>
            <Input
              id="edit-title"
              value={form.title}
              onChange={(e) => set('title')(e.target.value)}
            />
          </div>

          <div>
            <label
              htmlFor="edit-description"
              className="mb-1.5 block text-[13px] font-medium text-ink"
            >
              Description
            </label>
            <textarea
              id="edit-description"
              rows={5}
              className={FIELD}
              value={form.description}
              onChange={(e) => set('description')(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="edit-urgency"
                className="mb-1.5 block text-[13px] font-medium text-ink"
              >
                Urgency
              </label>
              <select
                id="edit-urgency"
                className={cn(FIELD, 'appearance-none')}
                value={form.urgency}
                onChange={(e) => set('urgency')(e.target.value)}
              >
                {options?.urgencies.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[12px] text-ink-muted">
                Urgency and impact together set the priority.
              </p>
            </div>

            <div>
              <label htmlFor="edit-impact" className="mb-1.5 block text-[13px] font-medium text-ink">
                Impact
              </label>
              <select
                id="edit-impact"
                className={cn(FIELD, 'appearance-none')}
                value={form.impact}
                onChange={(e) => set('impact')(e.target.value)}
              >
                {options?.impacts.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="edit-agent" className="mb-1.5 block text-[13px] font-medium text-ink">
                Assignee
              </label>
              <select
                id="edit-agent"
                className={cn(FIELD, 'appearance-none')}
                value={form.agentId}
                onChange={(e) => set('agentId')(e.target.value)}
              >
                <option value="">Unassigned</option>
                {options?.agents.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="edit-team" className="mb-1.5 block text-[13px] font-medium text-ink">
                Team
              </label>
              <select
                id="edit-team"
                className={cn(FIELD, 'appearance-none')}
                value={form.teamId}
                onChange={(e) => set('teamId')(e.target.value)}
              >
                <option value="">None</option>
                {options?.teams.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {update.isError ? (
            <p
              role="alert"
              className="rounded-control border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink"
            >
              {update.error instanceof Error ? update.error.message : 'Could not save those changes.'}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={update.isPending}>
            Save changes
          </Button>
        </div>
      </form>
    </div>
  );
}

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { DAY_LABEL, intervalProblems, PRESETS } from '../lib/business-hours';
import { WEEKDAYS, type CoverageWindow, type CoverageWindowInput, type OpenInterval } from '../business-hours.types';

interface CoverageWindowEditorProps {
  /** The window being edited; absent for a new one. */
  window?: CoverageWindow;
  saving: boolean;
  error?: string | undefined;
  onSave: (input: CoverageWindowInput) => void;
  onCancel: () => void;
}

/** Name, description and the open hours of each weekday (several periods a day allowed). */
export function CoverageWindowEditor({ window, saving, error, onSave, onCancel }: CoverageWindowEditorProps) {
  const [name, setName] = useState(window?.name ?? '');
  const [description, setDescription] = useState(window?.description ?? '');
  const [intervals, setIntervals] = useState<OpenInterval[]>(window?.intervals ?? PRESETS[0]!.intervals);
  const problems = intervalProblems(intervals);
  const canSave = name.trim() !== '' && intervals.length > 0 && problems.length === 0;

  const setAt = (index: number, patch: Partial<OpenInterval>) =>
    setIntervals((list) => list.map((i, k) => (k === index ? { ...i, ...patch } : i)));

  return (
    <form
      aria-label={window ? `Edit ${window.name}` : 'New coverage window'}
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) onSave({ name: name.trim(), description: description.trim(), intervals });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-[13px] text-ink-secondary">
          Name
          <Input className="mt-1" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} required />
        </label>
        <label className="block text-[13px] text-ink-secondary">
          Description
          <Input className="mt-1" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-secondary">
        Start from:
        {PRESETS.map((p) => (
          <Button key={p.label} type="button" variant="secondary" size="sm" onClick={() => setIntervals(p.intervals)}>
            {p.label}
          </Button>
        ))}
      </div>

      <table className="w-full text-[13px]" aria-label="Open hours">
        <tbody>
          {WEEKDAYS.map((day) => {
            const rows = intervals.map((i, index) => ({ i, index })).filter((r) => r.i.weekday === day);
            return (
              <tr key={day} className="border-t border-line align-top">
                <th scope="row" className="w-28 py-2 pr-3 text-left font-medium text-ink">
                  {DAY_LABEL[day]}
                </th>
                <td className="py-2">
                  <div className="flex flex-col gap-2">
                    {rows.length === 0 ? <span className="py-1.5 text-ink-muted">Closed</span> : null}
                    {rows.map(({ i, index }, n) => (
                      <div key={index} className="flex items-center gap-2">
                        <Input
                          type="time"
                          aria-label={`${DAY_LABEL[day]} period ${n + 1} from`}
                          className="w-32"
                          value={i.start}
                          onChange={(e) => setAt(index, { start: e.target.value })}
                        />
                        <span className="text-ink-muted">to</span>
                        <Select
                          aria-label={`${DAY_LABEL[day]} period ${n + 1} until`}
                          className="w-32"
                          value={i.end === '24:00' ? '24:00' : 'time'}
                          onChange={(e) => setAt(index, { end: e.target.value === '24:00' ? '24:00' : '17:00' })}
                          options={[
                            { value: 'time', label: 'a time' },
                            { value: '24:00', label: 'midnight' },
                          ]}
                        />
                        {i.end !== '24:00' ? (
                          <Input
                            type="time"
                            aria-label={`${DAY_LABEL[day]} period ${n + 1} to`}
                            className="w-32"
                            value={i.end}
                            onChange={(e) => setAt(index, { end: e.target.value })}
                          />
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`Remove ${DAY_LABEL[day]} period ${n + 1}`}
                          onClick={() => setIntervals((list) => list.filter((_, k) => k !== index))}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </Button>
                      </div>
                    ))}
                  </div>
                </td>
                <td className="w-24 py-2 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Add a period on ${DAY_LABEL[day]}`}
                    onClick={() => setIntervals((list) => [...list, { weekday: day, start: '09:00', end: '17:00' }])}
                  >
                    <Plus className="size-4" aria-hidden />
                    Add
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {problems.length || intervals.length === 0 ? (
        <ul role="alert" className="list-disc rounded-card border border-warning/30 bg-warning-soft px-6 py-2 text-[13px] text-ink">
          {intervals.length === 0 ? <li>Add at least one period of open hours.</li> : null}
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {error ? (
        <div role="alert" className="rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
          {error}
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!canSave} loading={saving}>
          {window ? 'Save window' : 'Create window'}
        </Button>
      </div>
    </form>
  );
}

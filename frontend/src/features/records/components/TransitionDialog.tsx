import { useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, Input } from '@/components/ui';
import { asksNextActionDate } from '../lib/transitions';
import type { ClassInfo, RecordDto } from '../types';
import { FieldInput } from './FieldControls';
import { fieldLabel } from './RecordForm';

/** The modal frame shared by the record screen's dialogs. */
export function RecordDialog({
  title,
  onClose,
  onSubmit,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  onSubmit?: (e: FormEvent) => void;
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[var(--arcus-scrim)] px-4 py-10 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.(e);
        }}
        className="w-full max-w-xl rounded-panel border border-line bg-surface-raised shadow-overlay"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-control p-1 text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-4 px-5 py-4">{children}</div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>
      </form>
    </div>
  );
}

/**
 * Asks for what a lifecycle action needs before it is applied.
 *
 * The fields come from the TARGET state's flags (see transitionPrompts), the
 * same rule iTop's own stimulus form follows, so "Resolve" asks for the
 * solution and resolution code and "Assign" for the team and agent.
 */
export function TransitionDialog({
  info,
  record,
  action,
  prompts,
  required,
  pending,
  error,
  onApply,
  onClose,
}: {
  info: ClassInfo;
  record: RecordDto;
  action: string;
  prompts: string[];
  required: Set<string>;
  pending: boolean;
  error?: string;
  onApply: (fields: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    for (const attcode of prompts) {
      const current = record.fields[attcode];
      // A case log is a stream of entries; what is typed here is a NEW entry.
      const isLog = info.fields[attcode]?.type === 'CaseLog';
      initial[attcode] =
        isLog || current === null || current === undefined || String(current) === '0'
          ? ''
          : String(current);
    }
    return initial;
  });

  // Putting a ticket on hold also asks when someone acts on it again.
  const asksDate = asksNextActionDate(info, record, action);
  const [nextActionDate, setNextActionDate] = useState('');
  const today = new Date().toLocaleDateString('en-CA');
  const missing = [
    ...[...required].filter((a) => (values[a] ?? '').trim() === ''),
    ...(asksDate && !(nextActionDate >= today) ? ['next_action_date'] : []),
  ];
  const label = info.labels.stimuli?.[action] ?? action;

  const submit = () => {
    if (missing.length > 0) return;
    const fields: Record<string, unknown> = {};
    for (const attcode of prompts) {
      if ((values[attcode] ?? '') !== '') fields[attcode] = values[attcode];
    }
    if (asksDate) fields['next_action_date'] = nextActionDate;
    onApply(fields);
  };

  return (
    <RecordDialog
      title={`${label} · ${record.label}`}
      onClose={onClose}
      onSubmit={submit}
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={pending} disabled={missing.length > 0}>
            {label}
          </Button>
        </>
      }
    >
      {error ? (
        <div
          role="alert"
          className="rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink"
        >
          {error}
        </div>
      ) : null}
      {prompts.map((attcode) => (
        <div key={attcode}>
          <label htmlFor={`field-${attcode}`} className="mb-1.5 block text-[13px] font-medium text-ink">
            {fieldLabel(info, attcode)}
            {required.has(attcode) ? <span className="ms-0.5 text-critical-ink">*</span> : null}
          </label>
          <FieldInput
            className={info.name}
            attcode={attcode}
            spec={info.fields[attcode]!}
            value={values[attcode] ?? ''}
            onChange={(value) => setValues((v) => ({ ...v, [attcode]: value }))}
            valueLabels={info.labels.values?.[attcode]}
          />
        </div>
      ))}
      {asksDate ? (
        <div>
          <label htmlFor="field-next_action_date" className="mb-1.5 block text-[13px] font-medium text-ink">
            Next action date<span className="ms-0.5 text-critical-ink">*</span>
          </label>
          <Input
            id="field-next_action_date"
            type="date"
            min={today}
            value={nextActionDate}
            onChange={(e) => setNextActionDate(e.target.value)}
          />
        </div>
      ) : null}
    </RecordDialog>
  );
}

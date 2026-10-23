import { useState } from 'react';
import { Button, Input, Select } from '@/components/ui';
import { RecordDialog } from '@/features/records';
import { useCreateKnownError } from '../api/useProblems';
import type { KnownErrorCreated, KnownErrorDomain, RootCauseAnalysis } from '../types';

const DOMAINS: Array<{ value: KnownErrorDomain; label: string }> = [
  { value: 'Application', label: 'Application' },
  { value: 'Desktop', label: 'Desktop' },
  { value: 'Network', label: 'Network' },
  { value: 'Server', label: 'Server' },
];

const CONTROL =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';

/**
 * Raises a known error from the problem in one step. The analysis is copied
 * as it was last saved, and the problem's CIs are linked to the new record.
 */
export function CreateKnownErrorDialog({
  problemId,
  defaultName,
  analysis,
  onClose,
  onCreated,
}: {
  problemId: string;
  defaultName: string;
  analysis: RootCauseAnalysis;
  onClose: () => void;
  onCreated: (created: KnownErrorCreated) => void;
}) {
  const create = useCreateKnownError(problemId);
  const [name, setName] = useState(defaultName.slice(0, 255));
  const [domain, setDomain] = useState<KnownErrorDomain>('Application');
  const [errorCode, setErrorCode] = useState('');
  const [symptom, setSymptom] = useState('');

  const copied = [
    ['Root cause', analysis.rootCause],
    ['Workaround', analysis.workaround],
    ['Solution', analysis.resolution],
  ].filter(([, text]) => text);

  return (
    <RecordDialog
      title="Create known error"
      onClose={onClose}
      onSubmit={() =>
        create.mutate(
          { name: name.trim() || undefined, domain, errorCode: errorCode.trim() || undefined, symptom: symptom.trim() || undefined },
          { onSuccess: onCreated },
        )
      }
      footer={
        <>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="sm" loading={create.isPending}>
            Create known error
          </Button>
        </>
      }
    >
      {create.isError ? (
        <div role="alert" className="rounded-card border border-critical/30 bg-critical-soft px-3 py-2 text-[13px] text-critical-ink">
          {create.error instanceof Error ? create.error.message : 'The known error could not be created.'}
        </div>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="ke-name" className="block text-[13px] font-medium text-ink">
          Name
        </label>
        <Input id="ke-name" value={name} maxLength={255} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor="ke-domain" className="block text-[13px] font-medium text-ink">
            Domain
          </label>
          <Select
            id="ke-domain"
            options={DOMAINS}
            value={domain}
            onChange={(e) => setDomain(e.target.value as KnownErrorDomain)}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="ke-code" className="block text-[13px] font-medium text-ink">
            Error code <span className="font-normal text-ink-muted">(optional)</span>
          </label>
          <Input id="ke-code" value={errorCode} maxLength={255} onChange={(e) => setErrorCode(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="ke-symptom" className="block text-[13px] font-medium text-ink">
          Symptom <span className="font-normal text-ink-muted">(optional)</span>
        </label>
        <textarea
          id="ke-symptom"
          rows={3}
          className={CONTROL}
          placeholder="What users see. Left empty, the problem's description is used."
          value={symptom}
          onChange={(e) => setSymptom(e.target.value)}
        />
      </div>

      <div className="rounded-card border border-line px-3 py-2 text-[13px]">
        <p className="text-[12px] font-medium text-ink-secondary">Copied from the problem</p>
        {copied.map(([label, text]) => (
          <p key={label} className="mt-1 line-clamp-3 whitespace-pre-wrap text-ink">
            <span className="font-medium">{label}: </span>
            {text}
          </p>
        ))}
        <p className="mt-1 text-[12px] text-ink-muted">Its configuration items are linked too.</p>
      </div>
    </RecordDialog>
  );
}

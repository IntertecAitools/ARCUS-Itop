'use client';

import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { FormField, RichText, describedBy, fieldLabelId } from '@/components/forms';
import { Button } from '@/components/ui';
import { caseLogNoteSchema } from '../schemas';

export interface CaseLogComposerProps {
  id: string;
  /** Resolve when the entry is saved; the editor is then cleared */
  onSubmit: (messageHtml: string) => Promise<unknown>;
  disabled?: boolean;
}

export function CaseLogComposer({ id, onSubmit, disabled }: CaseLogComposerProps) {
  const { t } = useTranslation('tickets');
  const { t: tc } = useTranslation();
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string>();
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = caseLogNoteSchema.safeParse({ message });
    if (!parsed.success) {
      setError(tc(parsed.error.issues[0]?.message ?? 'validation.required'));
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      await onSubmit(message);
      setMessage('');
    } catch {
      // the global toast reports the error; keep the text so it is not lost
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormField htmlFor={id} label={t('caseLog.addNote')} error={error} labelAs="span">
        <RichText
          id={id}
          value={message}
          onChange={setMessage}
          labelledBy={fieldLabelId(id)}
          describedBy={describedBy(id, { error })}
          placeholder={t('caseLog.placeholder')}
          invalid={!!error}
          disabled={disabled || saving}
          minHeightClass="min-h-24"
        />
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" loading={saving} disabled={disabled}>
          {t('caseLog.submit')}
        </Button>
      </div>
    </form>
  );
}

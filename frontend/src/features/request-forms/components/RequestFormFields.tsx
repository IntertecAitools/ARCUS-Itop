import { useEffect } from 'react';
import { Card, CardBody, CardHeader, Skeleton } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useFormFor } from '../api/request-forms.api';
import type { FormAnswers, FormField } from '../types';

/** The staff app's control look; the portal passes its own, larger one. */
const STAFF_CONTROL =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none ' +
  'placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40';

/** Renders a request form's questions as controls. Values are kept by the caller. */
export function RequestFormFields({
  fields,
  answers,
  onChange,
  controlClass = STAFF_CONTROL,
  labelClass = 'mb-1.5 block text-[13px] font-medium text-ink',
}: {
  fields: FormField[];
  answers: FormAnswers;
  onChange: (key: string, value: string) => void;
  controlClass?: string;
  labelClass?: string;
}) {
  return (
    <div className="space-y-4">
      {fields.map((f) => {
        const id = `form-${f.key}`;
        const value = answers[f.key] ?? '';
        const common = {
          id,
          value,
          required: f.required,
          'aria-describedby': f.help ? `${id}-help` : undefined,
        };
        return (
          <div key={f.key}>
            <label htmlFor={id} className={labelClass}>
              {f.label}
              {f.required ? (
                <span className="ms-0.5 text-critical-ink" aria-hidden>
                  *
                </span>
              ) : null}
            </label>
            {f.type === 'textarea' ? (
              <textarea {...common} rows={4} className={controlClass} onChange={(e) => onChange(f.key, e.target.value)} />
            ) : f.type === 'choice' ? (
              <select {...common} className={cn(controlClass, 'sm:w-80')} onChange={(e) => onChange(f.key, e.target.value)}>
                <option value="">Choose…</option>
                {(f.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : (
              <input
                {...common}
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                className={cn(controlClass, f.type === 'text' ? '' : 'sm:w-80')}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            )}
            {f.help ? (
              <p id={`${id}-help`} className="mt-1 text-[12.5px] text-ink-muted">
                {f.help}
              </p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The "Request details" card for a catalogue item: fetches its form and
 * renders it, or nothing when the item asks no extra questions. Reports the
 * fields up so the page can block submit on required ones and send answers.
 */
export function RequestFormSection({
  audience,
  serviceId,
  subcategoryId,
  answers,
  onChange,
  onFields,
  title = 'Request details',
  controlClass,
  className,
}: {
  audience: 'staff' | 'portal';
  serviceId?: number;
  subcategoryId?: number;
  answers: FormAnswers;
  onChange: (key: string, value: string) => void;
  onFields: (fields: FormField[]) => void;
  title?: string;
  controlClass?: string;
  className?: string;
}) {
  const { data: fields, isLoading, isError, error } = useFormFor(audience, serviceId, subcategoryId);

  useEffect(() => {
    onFields(serviceId ? (fields ?? []) : []);
    // onFields is a setter from the page; only the form itself matters here.
  }, [fields, serviceId]);

  if (!serviceId) return null;
  if (isLoading) return <Skeleton className={cn('h-24', className)} />;
  if (isError) {
    return (
      <div role="alert" className={cn('rounded-card border border-critical/30 bg-critical-soft px-4 py-3 text-[13px] text-critical-ink', className)}>
        {error instanceof Error ? error.message : 'The questions for this service could not be loaded.'}
      </div>
    );
  }
  if (!fields || fields.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader title={title} subtitle="What the support team needs to know for this service." />
      <CardBody>
        <RequestFormFields fields={fields} answers={answers} onChange={onChange} {...(controlClass ? { controlClass } : {})} />
      </CardBody>
    </Card>
  );
}

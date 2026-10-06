import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface FormFieldProps {
  /** id of the control; label, hint and error are linked to it */
  htmlFor: string;
  label: string;
  required?: boolean;
  hint?: string;
  /** Already-translated error message */
  error?: string;
  children: ReactNode;
  className?: string;
  /** Render the label as plain text (for controls labelled via aria-labelledby) */
  labelAs?: 'label' | 'span';
  requiredLabel?: string;
}

export const fieldLabelId = (id: string) => `${id}-label`;
export const fieldHintId = (id: string) => `${id}-hint`;
export const fieldErrorId = (id: string) => `${id}-error`;

/** aria-describedby value for a control inside a FormField */
export function describedBy(id: string, { hint, error }: { hint?: string; error?: string }): string | undefined {
  const ids = [hint ? fieldHintId(id) : null, error ? fieldErrorId(id) : null].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}

export function FormField({
  htmlFor,
  label,
  required,
  hint,
  error,
  children,
  className,
  labelAs = 'label',
  requiredLabel = 'required',
}: FormFieldProps) {
  const LabelTag = labelAs;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <LabelTag
        id={fieldLabelId(htmlFor)}
        {...(labelAs === 'label' ? { htmlFor } : {})}
        className="text-sm font-medium text-text"
      >
        {label}
        {required && (
          <>
            <span className="ml-0.5 text-danger" aria-hidden>
              *
            </span>
            <span className="sr-only"> ({requiredLabel})</span>
          </>
        )}
      </LabelTag>
      {children}
      {hint && !error && (
        <p id={fieldHintId(htmlFor)} className="text-xs text-text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={fieldErrorId(htmlFor)} role="alert" className="text-xs font-medium text-danger-strong">
          {error}
        </p>
      )}
    </div>
  );
}

/** Read-only value rendered in place of a control */
export function ReadOnlyValue({ children }: { children: ReactNode }) {
  return <div className="min-h-10 rounded-control bg-surface-muted px-3 py-2 text-sm text-text">{children || '—'}</div>;
}

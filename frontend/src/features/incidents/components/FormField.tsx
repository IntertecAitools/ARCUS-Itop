import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Shared input chrome, so every control on the form lines up identically. */
export const CONTROL =
  'w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-sm text-ink outline-none ' +
  'placeholder:text-ink-muted focus:border-brand focus:ring-2 focus:ring-ring/40 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-ink-muted';

/** A small all-caps rule that opens a group of related fields. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 text-[11px] font-semibold tracking-wider text-ink-muted uppercase">
      {children}
    </p>
  );
}

interface FieldProps {
  label: string;
  htmlFor: string;
  required?: boolean;
  /** Validation message. Replaces the hint while present. */
  error?: string;
  /** Always-on guidance, shown when there is no error. */
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * One labelled control.
 *
 * Error and hint share a slot: a field never shows both, because the error is
 * the more urgent of the two and stacking them shifts the layout.
 */
export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  className,
  children,
}: FieldProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-ink">
        {label}
        {required ? (
          <span className="ml-0.5 text-critical" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-[12px] text-critical-ink">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[12px] leading-4 text-ink-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** A `<select>` wearing the shared chrome, with a consistent placeholder row. */
export function Select({
  id,
  placeholder,
  options,
  disabled,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="relative">
      <select id={id} disabled={disabled} className={cn(CONTROL, 'appearance-none pr-9')} {...props}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-muted"
      >
        <path d="M6 8l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

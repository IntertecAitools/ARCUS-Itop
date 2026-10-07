import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leadingIcon?: ReactNode;
  /** Right-hand slot: a clear button, a unit, a keyboard hint. */
  trailing?: ReactNode;
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { leadingIcon, trailing, invalid, className, ...props },
  ref,
) {
  return (
    <div
      className={cn(
        'group flex h-9 items-center gap-2 rounded-control border bg-surface px-3',
        'transition-colors duration-150',
        'focus-within:border-brand focus-within:ring-2 focus-within:ring-ring/40',
        invalid ? 'border-critical' : 'border-line-strong',
        className,
      )}
    >
      {leadingIcon ? (
        <span className="shrink-0 text-ink-muted" aria-hidden>
          {leadingIcon}
        </span>
      ) : null}
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          'min-w-0 flex-1 bg-transparent text-sm text-ink outline-none',
          'placeholder:text-ink-muted',
          'disabled:cursor-not-allowed disabled:opacity-60',
        )}
        {...props}
      />
      {trailing ? <span className="shrink-0">{trailing}</span> : null}
    </div>
  );
});

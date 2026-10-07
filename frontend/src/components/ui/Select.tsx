import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: SelectOption[];
}

/**
 * Native select behind our chrome — keyboard, mobile pickers and screen readers
 * all come for free. A searchable picker belongs in `components/forms/ComboBox`.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { options, className, ...props },
  ref,
) {
  return (
    <div
      className={cn(
        'relative flex h-9 items-center rounded-control border border-line-strong bg-surface',
        'focus-within:border-brand focus-within:ring-2 focus-within:ring-ring/40',
        className,
      )}
    >
      <select
        ref={ref}
        className="h-full w-full appearance-none bg-transparent pr-8 pl-3 text-sm text-ink outline-none"
        {...props}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2.5 size-4 text-ink-muted"
        aria-hidden
      />
    </div>
  );
});
